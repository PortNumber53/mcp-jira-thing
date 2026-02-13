package httpserver

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"log"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/config"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/handlers"
	requesttracking "github.com/PortNumber53/mcp-jira-thing/backend/internal/middleware"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/store"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/worker"
)

// Server wraps an http.Server with convenience helpers for startup/shutdown.
type Server struct {
	httpServer *http.Server
	worker     *worker.Worker
}

// New constructs an HTTP server using the provided configuration and storage clients.
func New(cfg config.Config, db *sql.DB, userClient handlers.UserLister, authStore handlers.OAuthStore, settingsStore handlers.UserSettingsStore, billingStore handlers.BillingStore, userStore handlers.UserStore, jobWorker *worker.Worker, jobStore *store.JobStore, stripeHandler *handlers.StripeHandler) *Server {
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
	router.Get("/api/auth/connected-accounts", handlers.ConnectedAccounts(authStore))
	router.Post("/api/settings/jira", handlers.UserSettings(settingsStore))
	router.Get("/api/settings/jira", handlers.UserSettings(settingsStore))

	// Integration token endpoints
	integrationStore, _ := store.New(db)
	if integrationStore != nil {
		router.Get("/api/integrations/tokens", handlers.IntegrationTokens(integrationStore))
		router.Post("/api/integrations/tokens", handlers.IntegrationTokens(integrationStore))
		router.Delete("/api/integrations/tokens", handlers.IntegrationTokens(integrationStore))
	}

	// Billing endpoints
	router.Post("/api/billing/save-subscription", handlers.SaveSubscription(billingStore, userStore))
	router.Post("/api/billing/save-payment", handlers.SavePayment(billingStore, userStore))
	router.Get("/api/billing/payment-history", handlers.GetPaymentHistory(billingStore, userStore))
	router.Get("/api/billing/subscription", handlers.GetSubscription(billingStore))

	// Account management endpoints
	router.Post("/api/account/delete", handlers.DeleteAccount(billingStore, userStore, ""))

	router.Group(func(r chi.Router) {
		r.Use(mcpAuthMiddleware(db, s)) // Apply MCP auth middleware to this group
		r.Get("/api/settings/jira/tenant", handlers.TenantJiraSettings(settingsStore))
		r.Get("/api/mcp/secret", handlers.MCPSecret(settingsStore))
		r.Post("/api/mcp/secret", handlers.MCPSecret(settingsStore))
		if integrationStore != nil {
			r.Get("/api/integrations/tokens/tenant", handlers.TenantIntegrationToken(integrationStore))
		}
	})

	// Metrics endpoints
	if metricsStore != nil {
		router.Get("/api/metrics/user", handlers.UserMetrics(metricsStore))
		router.Get("/api/metrics/user/requests", handlers.UserRequests(metricsStore))
		router.Get("/api/metrics/all", handlers.AllMetrics(metricsStore))
	}

	// Job queue endpoints
	if jobStore != nil {
		jobHandler := handlers.NewJobHandler(jobStore, jobWorker)
		jobHandler.RegisterRoutes(router)
	}

	// Stripe / membership plan endpoints
	if stripeHandler != nil {
		stripeHandler.RegisterRoutes(router)
	}

	srv := &http.Server{
		Addr:         cfg.ServerAddress,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	return &Server{httpServer: srv, worker: jobWorker}
}

// Start begins serving HTTP traffic and starts the worker.
func (s *Server) Start() error {
	if s.worker != nil {
		log.Println("[server] Starting job worker...")
		s.worker.Start(context.Background())
	}
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully stops the HTTP server and worker.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.worker != nil {
		log.Println("[server] Shutting down job worker...")
		if err := s.worker.Stop(ctx); err != nil {
			log.Printf("[server] Worker shutdown error: %v", err)
		}
	}
	return s.httpServer.Shutdown(ctx)
}

// Handler exposes the underlying http.Handler for testing.
func (s *Server) Handler() http.Handler {
	return s.httpServer.Handler
}
