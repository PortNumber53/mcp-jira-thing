package config

import (
	"fmt"
	"os"
)

// Config captures runtime configuration values used by the backend service.
type Config struct {
	// ServerAddress is the host:port pair the HTTP server listens on. Defaults to "0.0.0.0:18111".
	ServerAddress string

	// DatabaseURL is the Postgres DSN used by database/sql for the primary database.
	DatabaseURL string

	// GoogleClientID is the OAuth 2.0 client ID for Google sign-in.
	GoogleClientID string

	// GoogleClientSecret is the OAuth 2.0 client secret for Google sign-in.
	GoogleClientSecret string

	// CookieSecret is the HMAC key used to sign session and state cookies.
	CookieSecret string

	// CookieDomain is the domain attribute set on cookies (e.g. ".dev.portnumber53.com").
	CookieDomain string

	// FrontendURL is the origin of the frontend app, used for post-login redirects.
	FrontendURL string

	// BackendURL is the public origin of this API server, used to build OAuth redirect URIs.
	BackendURL string
}

const (
	defaultServerAddress = "0.0.0.0:18111"
	envServerAddress     = "BACKEND_ADDR"
	envDatabaseURL       = "DATABASE_URL"
)

// Load reads configuration from environment variables, applies defaults, and returns
// a Config structure. Required values return an error when missing.
func Load() (Config, error) {
	cfg := Config{
		ServerAddress:      firstNonEmpty(os.Getenv(envServerAddress), defaultServerAddress),
		DatabaseURL:        os.Getenv(envDatabaseURL),
		GoogleClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		CookieSecret:       firstNonEmpty(os.Getenv("COOKIE_SECRET"), os.Getenv("SESSION_SECRET")),
		CookieDomain:       os.Getenv("COOKIE_DOMAIN"),
		FrontendURL:        os.Getenv("FRONTEND_URL"),
		BackendURL:         os.Getenv("BACKEND_URL"),
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
