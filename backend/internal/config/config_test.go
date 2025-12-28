package config

import (
	"strings"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv(envDatabaseURL, "postgresql://user:pass@db.example.com:5432/app?sslmode=disable")
	t.Setenv(envXataAPIKey, "test-key")
	t.Setenv(envXataWorkspace, "workspace")
	t.Setenv(envXataDatabase, "database")
	t.Setenv(envXataRegion, "eu-west-1")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if cfg.ServerAddress != defaultServerAddress {
		t.Fatalf("expected server address %q, got %q", defaultServerAddress, cfg.ServerAddress)
	}

	if cfg.XataBranch != defaultXataBranch {
		t.Fatalf("expected xata branch %q, got %q", defaultXataBranch, cfg.XataBranch)
	}

	if cfg.XataRegion != "eu-west-1" {
		t.Fatalf("expected region %q, got %q", "eu-west-1", cfg.XataRegion)
	}

	if cfg.XataDatabaseURL == "" {
		t.Fatal("expected XataDatabaseURL to be generated")
	}

	if !strings.Contains(cfg.XataDatabaseURL, "sslmode=require") {
		t.Fatalf("expected sslmode parameter in xata dsn, got %s", cfg.XataDatabaseURL)
	}
}

func TestLoadMissingRequired(t *testing.T) {
	t.Setenv(envDatabaseURL, "postgresql://user:pass@db.example.com:5432/app?sslmode=disable")
	t.Setenv(envXataWorkspace, "workspace")
	t.Setenv(envXataDatabase, "database")
	t.Setenv(envXataRegion, "us-east-1")

	// Xata config is optional unless you set any XATA_* pieces. Here we set some pieces
	// but omit XATA_API_KEY, so it should error.
	if _, err := Load(); err == nil {
		t.Fatal("expected error when XATA_API_KEY missing and Xata pieces are provided")
	}

	t.Setenv(envXataAPIKey, "key")
	t.Setenv(envXataWorkspace, "")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when workspace missing")
	}

	t.Setenv(envXataWorkspace, "workspace")
	t.Setenv(envXataDatabase, "")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when database missing")
	}

	t.Setenv(envXataDatabase, "database")
	t.Setenv(envXataRegion, "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error when region missing: %v", err)
	}
	if cfg.XataRegion != defaultXataRegion {
		t.Fatalf("expected default region %q, got %q", defaultXataRegion, cfg.XataRegion)
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	t.Setenv(envDatabaseURL, "")
	t.Setenv(envXataAPIKey, "test-key")
	t.Setenv(envXataWorkspace, "workspace")
	t.Setenv(envXataDatabase, "database")
	t.Setenv(envXataRegion, "us-east-1")

	if _, err := Load(); err == nil {
		t.Fatal("expected error when DATABASE_URL missing")
	}
}

func TestLoadXataDatabaseURLOverride(t *testing.T) {
	t.Setenv(envDatabaseURL, "postgresql://user:pass@db.example.com:5432/app?sslmode=disable")
	t.Setenv(envXataDatabaseURL, "postgresql://workspace:api-key@us-east-1.sql.xata.sh/dbjirathing:main?sslmode=require")
	t.Setenv(envXataAPIKey, "")
	t.Setenv(envXataWorkspace, "")
	t.Setenv(envXataDatabase, "")
	t.Setenv(envXataBranch, "")
	t.Setenv(envXataRegion, "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if cfg.XataDatabaseURL != "postgresql://workspace:api-key@us-east-1.sql.xata.sh/dbjirathing:main?sslmode=require" {
		t.Fatalf("expected XataDatabaseURL override, got %q", cfg.XataDatabaseURL)
	}
}

func TestLoadNoXataConfigAllowed(t *testing.T) {
	t.Setenv(envDatabaseURL, "postgresql://user:pass@db.example.com:5432/app?sslmode=disable")
	t.Setenv(envXataDatabaseURL, "")
	t.Setenv(envXataAPIKey, "")
	t.Setenv(envXataWorkspace, "")
	t.Setenv(envXataDatabase, "")
	t.Setenv(envXataBranch, "")
	t.Setenv(envXataRegion, "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.XataDatabaseURL != "" {
		t.Fatalf("expected XataDatabaseURL to be empty when xata is not configured, got %q", cfg.XataDatabaseURL)
	}
}

// Note: DATABASE_URL is treated as the primary DB DSN and is not parsed/validated
// beyond being required; sql.Open will surface connectivity/DSN issues at runtime.
