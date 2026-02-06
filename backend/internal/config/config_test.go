package config

import (
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv(envDatabaseURL, "postgresql://user:pass@db.example.com:5432/app?sslmode=disable")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if cfg.ServerAddress != defaultServerAddress {
		t.Fatalf("expected server address %q, got %q", defaultServerAddress, cfg.ServerAddress)
	}

	if cfg.DatabaseURL != "postgresql://user:pass@db.example.com:5432/app?sslmode=disable" {
		t.Fatalf("expected DATABASE_URL to be set, got %q", cfg.DatabaseURL)
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	t.Setenv(envDatabaseURL, "")

	if _, err := Load(); err == nil {
		t.Fatal("expected error when DATABASE_URL missing")
	}
}

func TestLoadCustomServerAddress(t *testing.T) {
	t.Setenv(envDatabaseURL, "postgresql://user:pass@db.example.com:5432/app")
	t.Setenv(envServerAddress, ":9999")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if cfg.ServerAddress != ":9999" {
		t.Fatalf("expected custom server address :9999, got %q", cfg.ServerAddress)
	}
}

// Note: DATABASE_URL is treated as the primary DB DSN and is not parsed/validated
// beyond being required; sql.Open will surface connectivity/DSN issues at runtime.
