package middleware

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/store"
)

// RequestTracker stores request metrics in the database
type RequestTracker struct {
	store *store.Store
}

// NewRequestTracker creates a new request tracker middleware
func NewRequestTracker(db *sql.DB) (*RequestTracker, error) {
	s, err := store.New(db)
	if err != nil {
		return nil, err
	}
	return &RequestTracker{store: s}, nil
}

// Middleware returns an HTTP middleware that tracks request metrics
func (rt *RequestTracker) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Create a response writer wrapper to capture status code and response size
			rw := &responseWriter{ResponseWriter: w, statusCode: 200}

			// Get user ID from context if available (set by auth middleware)
			var userID int64
			if uid, ok := r.Context().Value("user_id").(int64); ok {
				userID = uid
			}

			// Process the request
			next.ServeHTTP(rw, r)

			// Calculate response time
			responseTimeMs := int(time.Since(start).Milliseconds())

			// Get request size
			requestSizeBytes := int(r.ContentLength)
			if requestSizeBytes < 0 {
				requestSizeBytes = 0
			}

			// Get response size
			responseSizeBytes := rw.size

			// Track the request asynchronously to avoid blocking
			go func() {
				ctx := context.Background()
				err := rt.store.CreateRequest(
					ctx,
					userID,
					r.Method,
					r.URL.Path,
					rw.statusCode,
					&responseTimeMs,
					&requestSizeBytes,
					&responseSizeBytes,
					nil, // error message - could be enhanced to capture errors
				)
				if err != nil {
					// Log error but don't fail the request
					// In production, you might want to use a proper logger
					_ = err
				}
			}()
		})
	}
}

// responseWriter wraps http.ResponseWriter to capture status code and size
type responseWriter struct {
	http.ResponseWriter
	statusCode int
	size       int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.size += n
	return n, err
}
