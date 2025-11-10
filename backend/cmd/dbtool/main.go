package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	_ "github.com/lib/pq"
	"github.com/joho/godotenv"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/config"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/migrations"
)

func main() {
	// Load environment variables
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

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("failed to ping database: %v", err)
	}

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "fix":
			log.Printf("Attempting to fix dirty database...")
			if err := migrations.FixDirtyDatabase(db); err != nil {
				log.Fatalf("failed to fix dirty database: %v", err)
			}
			log.Printf("Database fixed successfully")
			
		case "force":
			if len(os.Args) < 3 {
				log.Fatalf("usage: %s force <version>", os.Args[0])
			}
			version := os.Args[2]
			var v uint
			if _, err := fmt.Sscanf(version, "%d", &v); err != nil {
				log.Fatalf("invalid version number: %s", version)
			}
			
			log.Printf("Forcing database version to %d...", v)
			if err := migrations.ForceVersion(db, v); err != nil {
				log.Fatalf("failed to force version: %v", err)
			}
			log.Printf("Database version forced to %d", v)
			
		case "status":
			log.Printf("Checking migration status...")
			// This would require adding a status function to migrations
			log.Printf("Status check not implemented yet")
			
		default:
			log.Printf("Usage: %s [fix|force <version>|status]", os.Args[0])
			os.Exit(1)
		}
	} else {
		log.Printf("Applying migrations...")
		if err := migrations.Up(db); err != nil {
			log.Fatalf("failed to apply migrations: %v", err)
		}
		log.Printf("Migrations applied successfully")
	}
}
