package config

import (
	"fmt"
	"os"
)

// Config captures runtime configuration values used by the backend service.
type Config struct {
	// ServerAddress is the host:port pair the HTTP server listens on. Defaults to ":18111".
	ServerAddress string

	// DatabaseURL is the Postgres DSN used by database/sql for the primary database.
	DatabaseURL string
}

const (
	defaultServerAddress = ":18111"
	envServerAddress     = "BACKEND_ADDR"
	envDatabaseURL       = "DATABASE_URL"
)

// Load reads configuration from environment variables, applies defaults, and returns
// a Config structure. Required values return an error when missing.
func Load() (Config, error) {
	cfg := Config{
		ServerAddress: firstNonEmpty(os.Getenv(envServerAddress), defaultServerAddress),
		DatabaseURL:   os.Getenv(envDatabaseURL),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("%s is required", envDatabaseURL)
	}

	return cfg, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
