package httpserver

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/config"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/handlers"
)

// Server wraps an http.Server with convenience helpers for startup/shutdown.
type Server struct {
	httpServer *http.Server
}

// New constructs an HTTP server using the provided configuration and storage clients.
func New(cfg config.Config, userClient handlers.UserLister, authStore handlers.OAuthStore, settingsStore handlers.UserSettingsStore) *Server {
	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(middleware.Logger)
	router.Use(middleware.Recoverer)

	router.Get("/healthz", handlers.Health)
	router.Get("/api/users", handlers.Users(userClient))
	router.Post("/api/auth/github", handlers.GitHubAuth(authStore))
	router.Post("/api/auth/google", handlers.GoogleAuth(authStore))
	router.Post("/api/settings/jira", handlers.UserSettings(settingsStore))
	router.Get("/api/settings/jira", handlers.UserSettings(settingsStore))

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
