package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv(envDatabaseURL, "")
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

	if cfg.HTTPClientTimeout != time.Duration(defaultHTTPTimeoutSec)*time.Second {
		t.Fatalf("unexpected timeout: %v", cfg.HTTPClientTimeout)
	}

	if cfg.DatabaseURL == "" {
		t.Fatal("expected DatabaseURL to be generated")
	}

	if !strings.Contains(cfg.DatabaseURL, "sslmode=require") {
		t.Fatalf("expected sslmode parameter in dsn, got %s", cfg.DatabaseURL)
	}
}

func TestLoadMissingRequired(t *testing.T) {
	t.Setenv(envDatabaseURL, "")
	t.Setenv(envXataWorkspace, "workspace")
	t.Setenv(envXataDatabase, "database")
	t.Setenv(envXataRegion, "us-east-1")

	if _, err := Load(); err == nil {
		t.Fatal("expected error when API key missing")
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

func TestLoadInvalidTimeout(t *testing.T) {
	t.Setenv(envDatabaseURL, "")
	t.Setenv(envXataAPIKey, "key")
	t.Setenv(envXataWorkspace, "workspace")
	t.Setenv(envXataDatabase, "database")
	t.Setenv(envXataRegion, "us-east-1")
	t.Setenv(envHTTPTimeoutSeconds, "0")

	if _, err := Load(); err == nil {
		t.Fatal("expected error for non-positive timeout")
	}
}

func TestLoadFromDatabaseURL(t *testing.T) {
	t.Setenv(envDatabaseURL, "postgresql://workspace:api-key@us-east-1.sql.xata.sh/dbjirathing:main?sslmode=require")
	t.Setenv(envXataAPIKey, "")
	t.Setenv(envXataWorkspace, "")
	t.Setenv(envXataDatabase, "")
	t.Setenv(envXataBranch, "")
	t.Setenv(envXataRegion, "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if cfg.XataAPIKey != "api-key" {
		t.Fatalf("unexpected api key: %q", cfg.XataAPIKey)
	}
	if cfg.XataWorkspace != "workspace" {
		t.Fatalf("unexpected workspace: %q", cfg.XataWorkspace)
	}
	if cfg.XataDatabase != "dbjirathing" {
		t.Fatalf("unexpected database: %q", cfg.XataDatabase)
	}
	if cfg.XataBranch != "main" {
		t.Fatalf("unexpected branch: %q", cfg.XataBranch)
	}
	if cfg.XataRegion != "us-east-1" {
		t.Fatalf("unexpected region: %q", cfg.XataRegion)
	}
	if cfg.DatabaseURL == "" {
		t.Fatal("expected DatabaseURL to be retained")
	}
}

func TestLoadDatabaseURLOverride(t *testing.T) {
	t.Setenv(envDatabaseURL, "postgresql://workspace:api-key@us-east-1.sql.xata.sh/dbjirathing:main")
	t.Setenv(envXataAPIKey, "direct-key")
	t.Setenv(envXataWorkspace, "direct-workspace")
	t.Setenv(envXataDatabase, "direct-db")
	t.Setenv(envXataBranch, "preview")
	t.Setenv(envXataRegion, "eu-central-1")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if cfg.XataAPIKey != "direct-key" {
		t.Fatalf("expected direct api key, got %q", cfg.XataAPIKey)
	}
	if cfg.XataWorkspace != "direct-workspace" {
		t.Fatalf("expected direct workspace, got %q", cfg.XataWorkspace)
	}
	if cfg.XataDatabase != "direct-db" {
		t.Fatalf("expected direct database, got %q", cfg.XataDatabase)
	}
	if cfg.XataBranch != "preview" {
		t.Fatalf("expected direct branch, got %q", cfg.XataBranch)
	}
	if cfg.XataRegion != "eu-central-1" {
		t.Fatalf("expected direct region, got %q", cfg.XataRegion)
	}
	if cfg.DatabaseURL == "" {
		t.Fatal("expected DatabaseURL to fall back to provided url")
	}
}

func TestLoadInvalidDatabaseURL(t *testing.T) {
	t.Setenv(envDatabaseURL, "postgresql://workspace@host/")
	t.Setenv(envXataAPIKey, "")
	t.Setenv(envXataWorkspace, "")
	t.Setenv(envXataDatabase, "")
	t.Setenv(envXataBranch, "")
	t.Setenv(envXataRegion, "")

	if _, err := Load(); err == nil {
		t.Fatal("expected error for invalid DATABASE_URL")
	}
}
