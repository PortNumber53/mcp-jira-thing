package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config captures runtime configuration values used by the backend service.
type Config struct {
	// ServerAddress is the host:port pair the HTTP server listens on. Defaults to ":8080".
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
	// or constructed from the Xata* values above.
	DatabaseURL string

	// HTTPClientTimeout defines the timeout applied to outbound Postgres queries.
	HTTPClientTimeout time.Duration
}

const (
	defaultServerAddress  = ":8080"
	defaultXataBranch     = "main"
	defaultXataRegion     = "us-east-1"
	defaultHTTPTimeoutSec = 15
	envServerAddress      = "BACKEND_ADDR"
	envXataAPIKey         = "XATA_API_KEY"
	envXataWorkspace      = "XATA_WORKSPACE"
	envXataDatabase       = "XATA_DATABASE"
	envXataBranch         = "XATA_BRANCH"
	envXataRegion         = "XATA_REGION"
	envHTTPTimeoutSeconds = "BACKEND_HTTP_TIMEOUT_SECONDS"
	envDatabaseURL        = "DATABASE_URL"
)

// Load reads configuration from environment variables, applies defaults, and returns
// a Config structure. Required values return an error when missing.
func Load() (Config, error) {
	cfg := Config{
		ServerAddress:     firstNonEmpty(os.Getenv(envServerAddress), defaultServerAddress),
		XataBranch:        defaultXataBranch,
		XataRegion:        defaultXataRegion,
		DatabaseURL:       os.Getenv(envDatabaseURL),
		HTTPClientTimeout: time.Duration(defaultHTTPTimeoutSec) * time.Second,
	}

	cfg.XataAPIKey = os.Getenv(envXataAPIKey)
	cfg.XataWorkspace = os.Getenv(envXataWorkspace)
	cfg.XataDatabase = os.Getenv(envXataDatabase)
	cfg.XataBranch = firstNonEmpty(os.Getenv(envXataBranch), cfg.XataBranch)
	cfg.XataRegion = firstNonEmpty(os.Getenv(envXataRegion), cfg.XataRegion)

	if cfg.DatabaseURL != "" {
		parsed, err := parseDatabaseURL(cfg.DatabaseURL)
		if err != nil {
			return Config{}, fmt.Errorf("invalid %s: %w", envDatabaseURL, err)
		}
		if cfg.XataAPIKey == "" {
			cfg.XataAPIKey = parsed.APIKey
		}
		if cfg.XataWorkspace == "" {
			cfg.XataWorkspace = parsed.Workspace
		}
		if cfg.XataDatabase == "" {
			cfg.XataDatabase = parsed.Database
		}
		if cfg.XataBranch == "" {
			cfg.XataBranch = parsed.Branch
		}
		if cfg.XataRegion == "" || cfg.XataRegion == defaultXataRegion {
			cfg.XataRegion = parsed.Region
		}
	}

	cfg.XataWorkspace = firstNonEmpty(os.Getenv(envXataWorkspace), cfg.XataWorkspace)
	cfg.XataDatabase = firstNonEmpty(os.Getenv(envXataDatabase), cfg.XataDatabase)
	cfg.XataBranch = firstNonEmpty(os.Getenv(envXataBranch), cfg.XataBranch)
	cfg.XataRegion = firstNonEmpty(os.Getenv(envXataRegion), cfg.XataRegion)
	cfg.XataAPIKey = firstNonEmpty(os.Getenv(envXataAPIKey), cfg.XataAPIKey)

	if cfg.XataAPIKey == "" {
		return Config{}, fmt.Errorf("%s is required", envXataAPIKey)
	}
	if cfg.XataWorkspace == "" {
		return Config{}, fmt.Errorf("%s is required", envXataWorkspace)
	}
	if cfg.XataDatabase == "" {
		return Config{}, fmt.Errorf("%s is required", envXataDatabase)
	}
	if cfg.XataRegion == "" {
		return Config{}, fmt.Errorf("%s is required", envXataRegion)
	}

	if cfg.DatabaseURL == "" {
		dsn, err := buildDatabaseURL(cfg)
		if err != nil {
			return Config{}, err
		}
		cfg.DatabaseURL = dsn
	}

	if timeoutRaw := os.Getenv(envHTTPTimeoutSeconds); timeoutRaw != "" {
		seconds, err := strconv.Atoi(timeoutRaw)
		if err != nil {
			return Config{}, fmt.Errorf("invalid %s value %q: %w", envHTTPTimeoutSeconds, timeoutRaw, err)
		}
		if seconds <= 0 {
			return Config{}, fmt.Errorf("%s must be > 0", envHTTPTimeoutSeconds)
		}
		cfg.HTTPClientTimeout = time.Duration(seconds) * time.Second
	}

	return cfg, nil
}

type databaseURLParts struct {
	Workspace string
	APIKey    string
	Database  string
	Branch    string
	Region    string
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func parseDatabaseURL(raw string) (databaseURLParts, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return databaseURLParts{}, err
	}

	if parsed.User == nil {
		return databaseURLParts{}, fmt.Errorf("missing credentials")
	}

	workspace := parsed.User.Username()
	if workspace == "" {
		return databaseURLParts{}, fmt.Errorf("missing workspace in username")
	}

	apiKey, hasPassword := parsed.User.Password()
	if !hasPassword || apiKey == "" {
		return databaseURLParts{}, fmt.Errorf("missing api key in password field")
	}

	hostParts := strings.Split(parsed.Hostname(), ".")
	region := defaultXataRegion
	if len(hostParts) >= 1 && hostParts[0] != "" {
		region = hostParts[0]
	}

	path := strings.TrimPrefix(parsed.Path, "/")
	if path == "" {
		return databaseURLParts{}, fmt.Errorf("missing database/branch in path")
	}

	segments := strings.Split(path, ":")
	database := segments[0]
	if database == "" {
		return databaseURLParts{}, fmt.Errorf("missing database name")
	}

	branch := defaultXataBranch
	if len(segments) > 1 && segments[1] != "" {
		branch = segments[1]
	}

	return databaseURLParts{
		Workspace: workspace,
		APIKey:    apiKey,
		Database:  database,
		Branch:    branch,
		Region:    region,
	}, nil
}

func buildDatabaseURL(cfg Config) (string, error) {
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
