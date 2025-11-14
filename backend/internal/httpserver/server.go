package httpserver

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/config"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/handlers"
	requesttracking "github.com/PortNumber53/mcp-jira-thing/backend/internal/middleware"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/store"
	"log"
)

// Server wraps an http.Server with convenience helpers for startup/shutdown.
type Server struct {
	httpServer *http.Server
}

// New constructs an HTTP server using the provided configuration and storage clients.
func New(cfg config.Config, db *sql.DB, userClient handlers.UserLister, authStore handlers.OAuthStore, settingsStore handlers.UserSettingsStore, billingStore handlers.BillingStore, userStore handlers.UserStore) *Server {
	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(middleware.Logger)
	router.Use(middleware.Recoverer)

	// Add custom MCP auth middleware function
	mcpAuthMiddleware := func(db *sql.DB, store *store.Store) func(next http.Handler) http.Handler {
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				secret := r.URL.Query().Get("mcp_secret")
				if secret != "" {
					userID, err := store.GetUserIDByMCPSecret(r.Context(), secret) // Assume or add this method in store if not exist
					if err == nil && userID > 0 {
						ctx := context.WithValue(r.Context(), "user_id", userID)
						r = r.WithContext(ctx)
					} else {
						log.Printf("[mcpAuth] Invalid MCP secret: %v", err)
					}
				}
				next.ServeHTTP(w, r)
			})
		}
	}

	// Add custom MCP auth middleware using the store
	s, err := store.New(db)
	if err != nil {
		log.Printf("failed to create store for MCP auth: %v", err)
	} else {
		router.Use(mcpAuthMiddleware(db, s))
	}

	// Add request tracking middleware
	requestTracker, err := requesttracking.NewRequestTracker(db)
	if err != nil {
		// Log and continue without tracking
		router.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				next.ServeHTTP(w, r)
			})
		})
	} else {
		router.Use(requestTracker.Middleware())
	}

	// Create a store that implements MetricsStore for the metrics endpoints
	metricsStore, err := store.New(db)
	if err != nil {
		// Handle error appropriately - for now, don't register metrics endpoints
		metricsStore = nil
	}

	router.Get("/healthz", handlers.Health)
	router.Get("/api/users", handlers.Users(userClient))
	router.Post("/api/auth/github", handlers.GitHubAuth(authStore))
	router.Post("/api/auth/google", handlers.GoogleAuth(authStore))
	router.Post("/api/settings/jira", handlers.UserSettings(settingsStore))
	router.Get("/api/settings/jira", handlers.UserSettings(settingsStore))

	// Billing endpoints
	router.Post("/api/billing/save-subscription", handlers.SaveSubscription(billingStore, userStore))
	router.Post("/api/billing/save-payment", handlers.SavePayment(billingStore, userStore))
	router.Get("/api/billing/payment-history", handlers.GetPaymentHistory(billingStore, userStore))
	router.Get("/api/billing/subscription", handlers.GetSubscription(billingStore))

	router.Group(func(r chi.Router) {
		r.Use(mcpAuthMiddleware(db, s)) // Apply MCP auth middleware to this group
		r.Get("/api/settings/jira/tenant", handlers.TenantJiraSettings(settingsStore))
		r.Get("/api/mcp/secret", handlers.MCPSecret(settingsStore))
		r.Post("/api/mcp/secret", handlers.MCPSecret(settingsStore))
	})
	
	// Metrics endpoints
	if metricsStore != nil {
		router.Get("/api/metrics/user", handlers.UserMetrics(metricsStore))
		router.Get("/api/metrics/user/requests", handlers.UserRequests(metricsStore))
		router.Get("/api/metrics/all", handlers.AllMetrics(metricsStore))
	}

	srv := &http.Server{
		Addr:         cfg.ServerAddress,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	return &Server{httpServer: srv}
}

// Start begins serving HTTP traffic until the process is stopped.
func (s *Server) Start() error {
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully stops the HTTP server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

// Handler exposes the underlying http.Handler for testing.
func (s *Server) Handler() http.Handler {
	return s.httpServer.Handler
}
