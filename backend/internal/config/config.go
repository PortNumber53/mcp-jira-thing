package config

import (
	"fmt"
	"net/url"
	"os"
)

// Config captures runtime configuration values used by the backend service.
type Config struct {
	// ServerAddress is the host:port pair the HTTP server listens on. Defaults to ":18111".
	ServerAddress string

	// XataAPIKey is the API token used to authenticate against the Xata Postgres endpoint.
	XataAPIKey string

	// XataWorkspace identifies the Xata workspace (e.g. "my-workspace").
	XataWorkspace string

	// XataDatabase is the database name within the workspace (e.g. "dbjirathing").
	XataDatabase string

	// XataBranch is the branch to query. Defaults to "main".
	XataBranch string

	// XataRegion is the deployment region (e.g. "us-east-1"). Defaults to "us-east-1".
	XataRegion string

	// DatabaseURL is the Postgres DSN used by database/sql. Either supplied directly
	// and used as the primary (non-Xata) database.
	DatabaseURL string

	// XataDatabaseURL is the Postgres DSN for the legacy Xata database used during
	// the migration period (for running migrations and copying data into DatabaseURL).
	XataDatabaseURL string
}

const (
	defaultServerAddress = ":18111"
	defaultXataBranch    = "main"
	defaultXataRegion    = "us-east-1"
	envServerAddress     = "BACKEND_ADDR"
	envXataAPIKey        = "XATA_API_KEY"
	envXataWorkspace     = "XATA_WORKSPACE"
	envXataDatabase      = "XATA_DATABASE"
	envXataBranch        = "XATA_BRANCH"
	envXataRegion        = "XATA_REGION"
	envXataDatabaseURL   = "XATA_DATABASE_URL"
	envDatabaseURL       = "DATABASE_URL"
)

// Load reads configuration from environment variables, applies defaults, and returns
// a Config structure. Required values return an error when missing.
func Load() (Config, error) {
	cfg := Config{
		ServerAddress:   firstNonEmpty(os.Getenv(envServerAddress), defaultServerAddress),
		XataBranch:      defaultXataBranch,
		XataRegion:      defaultXataRegion,
		DatabaseURL:     os.Getenv(envDatabaseURL),
		XataDatabaseURL: os.Getenv(envXataDatabaseURL),
	}

	if value := os.Getenv(envXataAPIKey); value != "" {
		cfg.XataAPIKey = value
	}
	if value := os.Getenv(envXataWorkspace); value != "" {
		cfg.XataWorkspace = value
	}
	if value := os.Getenv(envXataDatabase); value != "" {
		cfg.XataDatabase = value
	}
	if value := os.Getenv(envXataBranch); value != "" {
		cfg.XataBranch = value
	}
	if value := os.Getenv(envXataRegion); value != "" {
		cfg.XataRegion = value
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("%s is required", envDatabaseURL)
	}

	// Xata DSN can be supplied directly (preferred) or built from the XATA_* pieces.
	if cfg.XataDatabaseURL == "" {
		// Xata configuration is optional. Only attempt to construct the DSN when at least
		// one XATA_* value is set (to avoid forcing legacy settings for primary-only runs).
		hasAnyXataPiece := cfg.XataAPIKey != "" || cfg.XataWorkspace != "" || cfg.XataDatabase != "" || os.Getenv(envXataBranch) != "" || os.Getenv(envXataRegion) != ""
		if hasAnyXataPiece {
			// If any pieces are set, require the full set needed to build a DSN.
			if cfg.XataAPIKey == "" {
				return Config{}, fmt.Errorf("%s is required (or set %s)", envXataAPIKey, envXataDatabaseURL)
			}
			if cfg.XataWorkspace == "" {
				return Config{}, fmt.Errorf("%s is required (or set %s)", envXataWorkspace, envXataDatabaseURL)
			}
			if cfg.XataDatabase == "" {
				return Config{}, fmt.Errorf("%s is required (or set %s)", envXataDatabase, envXataDatabaseURL)
			}
			if cfg.XataRegion == "" {
				return Config{}, fmt.Errorf("%s is required (or set %s)", envXataRegion, envXataDatabaseURL)
			}

			dsn, err := buildXataDatabaseURL(cfg)
			if err != nil {
				return Config{}, err
			}
			cfg.XataDatabaseURL = dsn
		}
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

func buildXataDatabaseURL(cfg Config) (string, error) {
	u := &url.URL{
		Scheme: "postgresql",
		User:   url.UserPassword(cfg.XataWorkspace, cfg.XataAPIKey),
		Host:   fmt.Sprintf("%s.sql.xata.sh", cfg.XataRegion),
		Path:   fmt.Sprintf("/%s:%s", cfg.XataDatabase, cfg.XataBranch),
	}

	q := u.Query()
	if q.Get("sslmode") == "" {
		q.Set("sslmode", "require")
	}
	u.RawQuery = q.Encode()

	return u.String(), nil
}
