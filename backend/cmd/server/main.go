package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/config"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/httpserver"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/migrations"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/store"
)

type runtimeFlags struct {
	forceMigration bool
}

func main() {
	var flags runtimeFlags
	flag.BoolVar(&flags.forceMigration, "force-migration", false, "force re-running the Xata -> primary migration copy even if the primary database already has data")
	flag.Parse()

	// Best-effort: load environment variables from .env-style files in local
	// development. These calls are safe to ignore in production environments.
	_ = godotenv.Load(
		"../.env",
		".env",
	)

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load configuration: %v", err)
	}

	primaryDB, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to open primary database: %v", err)
	}
	defer primaryDB.Close()

	logDBTarget("primary", cfg.DatabaseURL)
	hasXata := cfg.XataDatabaseURL != ""
	var xataDB *sql.DB
	if hasXata {
		var err error
		xataDB, err = sql.Open("postgres", cfg.XataDatabaseURL)
		if err != nil {
			log.Fatalf("failed to open xata database: %v", err)
		}
		defer xataDB.Close()
		logDBTarget("xata", cfg.XataDatabaseURL)
		if sameDBTarget(cfg.DatabaseURL, cfg.XataDatabaseURL) {
			log.Fatalf("configuration error: primary database (DATABASE_URL) and legacy xata database (XATA_DATABASE_URL / XATA_*) point to the same target; refusing to continue")
		}
	} else {
		log.Printf("db(xata): not configured; skipping xata migrations and xata -> primary sync")
	}

	configureDB(primaryDB)
	if hasXata {
		configureDB(xataDB)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := primaryDB.PingContext(ctx); err != nil {
		log.Fatalf("failed to ping primary database: %v", err)
	}
	if hasXata {
		if err := xataDB.PingContext(ctx); err != nil {
			log.Fatalf("failed to ping xata database: %v", err)
		}
	}

	if err := runMigrationsWithDirtyFix(primaryDB, "primary"); err != nil {
		log.Fatalf("failed to apply primary database migrations: %v", err)
	}
	if hasXata {
		if err := runMigrationsWithDirtyFix(xataDB, "xata"); err != nil {
			log.Fatalf("failed to apply xata database migrations: %v", err)
		}
	}

	if err := migrations.EnsureMigrationJobsTable(ctx, primaryDB); err != nil {
		log.Fatalf("migration job: failed ensuring migration jobs table: %v", err)
	}

	if hasXata {
		shouldSync, reason, err := shouldSyncXataToPrimary(ctx, primaryDB, flags.forceMigration)
		if err != nil {
			log.Fatalf("migration job: failed determining whether to sync: %v", err)
		}

		if shouldSync {
			log.Printf("migration job: syncing data from xata -> primary (reason=%s, force=%t)", reason, flags.forceMigration)
			if err := migrations.SyncXataToPrimary(context.Background(), xataDB, primaryDB); err != nil {
				log.Fatalf("migration job: failed syncing data from xata -> primary: %v", err)
			}
		} else {
			log.Printf("migration job: skipping xata -> primary sync (reason=%s, use --force-migration to re-run)", reason)
		}
	}

	store, err := store.New(primaryDB)
	if err != nil {
		log.Fatalf("failed to create store: %v", err)
	}

	srv := httpserver.New(cfg, primaryDB, store, store, store, store, store)

	shutdownCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		<-shutdownCtx.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("graceful shutdown failed: %v", err)
		}
	}()

	log.Printf("backend starting on %s", cfg.ServerAddress)
	if err := srv.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("server exited with error: %v", err)
		os.Exit(1)
	}
}

func configureDB(db *sql.DB) {
	db.SetConnMaxLifetime(30 * time.Minute)
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
}

func runMigrationsWithDirtyFix(db *sql.DB, name string) error {
	if err := migrations.Up(db); err != nil {
		log.Printf("migrations(%s): error detected: %v (type: %T)", name, err, err)
		if strings.Contains(err.Error(), "Dirty database version") {
			log.Printf("migrations(%s): dirty database detected, attempting to fix...", name)
			if fixErr := migrations.FixDirtyDatabase(db); fixErr != nil {
				log.Printf("migrations(%s): failed to fix dirty database: %v", name, fixErr)
				return err
			}
			if retryErr := migrations.Up(db); retryErr != nil {
				return retryErr
			}
			return nil
		}
		return err
	}
	return nil
}

func shouldSyncXataToPrimary(ctx context.Context, primaryDB *sql.DB, force bool) (bool, string, error) {
	if force {
		return true, "force-migration", nil
	}

	completed, err := migrations.HasCompletedXataToPrimarySync(ctx, primaryDB)
	if err != nil {
		return false, "", err
	}
	if !completed {
		return true, "sync-not-completed", nil
	}

	// If the users table doesn't exist in the current schema, we should sync
	// (it likely means the primary DB is fresh or schema/search_path differs).
	var usersReg sql.NullString
	if err := primaryDB.QueryRowContext(ctx, `SELECT to_regclass('public.users')::text`).Scan(&usersReg); err != nil {
		return false, "", err
	}
	if !usersReg.Valid || usersReg.String == "" {
		return true, "users-table-missing", nil
	}

	// If there are no users, treat as fresh and sync.
	var hasAnyUser bool
	if err := primaryDB.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM users LIMIT 1)`).Scan(&hasAnyUser); err != nil {
		return false, "", err
	}
	if !hasAnyUser {
		return true, "users-empty", nil
	}

	return false, "sync-completed", nil
}

func logDBTarget(name, dsn string) {
	// Avoid logging secrets: only log hostname + database path.
	u, err := url.Parse(dsn)
	if err != nil {
		log.Printf("db(%s): configured (dsn parse error: %v)", name, err)
		return
	}
	log.Printf("db(%s): host=%s db=%s", name, u.Hostname(), strings.TrimPrefix(u.Path, "/"))
}

func sameDBTarget(a, b string) bool {
	ua, errA := url.Parse(a)
	ub, errB := url.Parse(b)
	if errA != nil || errB != nil {
		return false
	}
	return strings.EqualFold(ua.Hostname(), ub.Hostname()) && strings.TrimPrefix(ua.Path, "/") == strings.TrimPrefix(ub.Path, "/")
}
