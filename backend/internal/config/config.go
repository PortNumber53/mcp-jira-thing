package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

	// GitHubClientID is the OAuth 2.0 client ID for GitHub sign-in.
	GitHubClientID string

	// GitHubClientSecret is the OAuth 2.0 client secret for GitHub sign-in.
	GitHubClientSecret string

	// CookieSecret is the HMAC key used to sign session and state cookies.
	CookieSecret string

	// CookieDomain is the domain attribute set on cookies (e.g. ".dev.portnumber53.com").
	CookieDomain string

	// FrontendURL is the origin of the frontend app, used for post-login redirects and CORS.
	FrontendURL string

	// BackendURL is the public origin of this API server, used to build OAuth redirect URIs.
	BackendURL string

	// AllowedOrigins is a comma-separated list of origins allowed for CORS.
	// Defaults to FrontendURL if empty.
	AllowedOrigins string

	// MCPSessionAPIToken authenticates the Node MCP service to the internal
	// transport-session API. It falls back to CookieSecret for compatibility.
	MCPSessionAPIToken string

	// StripeSecretKey is the Stripe API key for billing. If empty, billing is disabled.
	StripeSecretKey string

	// StripeWebhookSecret is the Stripe webhook signing secret.
	StripeWebhookSecret string

	// StripePriceID is the default Stripe price ID for subscription creation.
	StripePriceID string
}

const (
	defaultServerAddress = "0.0.0.0:18111"
	envServerAddress     = "BACKEND_ADDR"
	envDatabaseURL       = "DATABASE_URL"
)

// Load reads configuration from environment variables, applies defaults, and returns
// a Config structure. Required values return an error when missing.
func Load() (Config, error) {
	loadConfigINI()
	cfg := Config{
		ServerAddress:       firstNonEmpty(os.Getenv(envServerAddress), defaultServerAddress),
		DatabaseURL:         os.Getenv(envDatabaseURL),
		GoogleClientID:      os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret:  os.Getenv("GOOGLE_CLIENT_SECRET"),
		GitHubClientID:      os.Getenv("GITHUB_CLIENT_ID"),
		GitHubClientSecret:  os.Getenv("GITHUB_CLIENT_SECRET"),
		CookieSecret:        firstNonEmpty(os.Getenv("COOKIE_SECRET"), os.Getenv("SESSION_SECRET")),
		CookieDomain:        os.Getenv("COOKIE_DOMAIN"),
		FrontendURL:         os.Getenv("FRONTEND_URL"),
		BackendURL:          os.Getenv("BACKEND_URL"),
		AllowedOrigins:      os.Getenv("ALLOWED_ORIGINS"),
		MCPSessionAPIToken:  firstNonEmpty(os.Getenv("MCP_SESSION_API_TOKEN"), os.Getenv("COOKIE_SECRET"), os.Getenv("SESSION_SECRET")),
		StripeSecretKey:     os.Getenv("STRIPE_SECRET_KEY"),
		StripeWebhookSecret: os.Getenv("STRIPE_WEBHOOK_SECRET"),
		StripePriceID:       os.Getenv("STRIPE_PRICE_ID"),
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

func loadConfigINI() {
	paths := []string{"/etc/mcp-jira-thing/config.ini"}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		paths = append(paths, filepath.Join(home, ".config", "mcp-jira-thing", "config.ini"))
	}
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
				continue
			}
			if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
				continue
			}
			key, val, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			key = strings.TrimSpace(key)
			val = strings.TrimSpace(val)
			val = strings.Trim(val, "'")
			if key != "" && os.Getenv(key) == "" {
				os.Setenv(key, val)
			}
		}
		f.Close()
	}
}
