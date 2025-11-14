package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/joho/godotenv"

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
		"../.dev.vars",
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

	db.SetConnMaxLifetime(30 * time.Minute)
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("failed to ping database: %v", err)
	}

	if err := migrations.Up(db); err != nil {
		// Check if it's a dirty database error and try to fix it
		log.Printf("migrations: error detected: %v (type: %T)", err, err)
		if strings.Contains(err.Error(), "Dirty database version") {
			log.Printf("migrations: dirty database detected, attempting to fix...")
			if fixErr := migrations.FixDirtyDatabase(db); fixErr != nil {
				log.Printf("migrations: failed to fix dirty database: %v", fixErr)
				log.Fatalf("failed to apply database migrations: %v", err)
			}
			
			// Try applying migrations again after fixing dirty state
			if retryErr := migrations.Up(db); retryErr != nil {
				log.Fatalf("failed to apply database migrations after fixing dirty state: %v", retryErr)
			}
		} else {
			log.Fatalf("failed to apply database migrations: %v", err)
		}
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
