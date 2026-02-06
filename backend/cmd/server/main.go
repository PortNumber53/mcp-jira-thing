package main

import (
	"context"
	"database/sql"
	"errors"
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

func main() {
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

	db, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer db.Close()

	logDBTarget("primary", cfg.DatabaseURL)
	configureDB(db)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("failed to ping database: %v", err)
	}

	if err := runMigrationsWithDirtyFix(db, "primary"); err != nil {
		log.Fatalf("failed to apply database migrations: %v", err)
	}

	store, err := store.New(db)
	if err != nil {
		log.Fatalf("failed to create store: %v", err)
	}

	srv := httpserver.New(cfg, db, store, store, store, store, store)

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

func logDBTarget(name, dsn string) {
	// Avoid logging secrets: only log hostname + database path.
	u, err := url.Parse(dsn)
	if err != nil {
		log.Printf("db(%s): configured (dsn parse error: %v)", name, err)
		return
	}
	log.Printf("db(%s): host=%s db=%s", name, u.Hostname(), strings.TrimPrefix(u.Path, "/"))
}
