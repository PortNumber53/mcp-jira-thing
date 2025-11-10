package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

// MetricsStore defines the behaviour required from the storage client used
// by the metrics handlers.
type MetricsStore interface {
	GetUserRequests(ctx context.Context, userID int64, limit, offset int) ([]models.Request, error)
	GetUserMetrics(ctx context.Context, userID int64) (*models.RequestMetrics, error)
	GetAllMetrics(ctx context.Context) ([]models.RequestMetrics, error)
}

// UserMetrics returns usage metrics for the authenticated user
func UserMetrics(store MetricsStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Get user ID from context (should be set by auth middleware)
		userID, ok := r.Context().Value("user_id").(int64)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		metrics, err := store.GetUserMetrics(r.Context(), userID)
		if err != nil {
			http.Error(w, "failed to get user metrics", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(metrics); err != nil {
			http.Error(w, "failed to encode response", http.StatusInternalServerError)
			return
		}
	}
}

// UserRequests returns detailed request history for the authenticated user
func UserRequests(store MetricsStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Get user ID from context (should be set by auth middleware)
		userID, ok := r.Context().Value("user_id").(int64)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		// Parse pagination parameters
		limit := 50 // default
		offset := 0

		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 200 {
				limit = parsed
			}
		}

		if o := r.URL.Query().Get("offset"); o != "" {
			if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
				offset = parsed
			}
		}

		requests, err := store.GetUserRequests(r.Context(), userID, limit, offset)
		if err != nil {
			http.Error(w, "failed to get user requests", http.StatusInternalServerError)
			return
		}

		response := map[string]interface{}{
			"requests": requests,
			"limit":    limit,
			"offset":   offset,
			"total":    len(requests),
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(response); err != nil {
			http.Error(w, "failed to encode response", http.StatusInternalServerError)
			return
		}
	}
}

// AllMetrics returns usage metrics for all users (admin endpoint)
func AllMetrics(store MetricsStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// TODO: Add admin authentication check here
		// For now, this endpoint is open - you may want to restrict it

		metrics, err := store.GetAllMetrics(r.Context())
		if err != nil {
			http.Error(w, "failed to get all metrics", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(metrics); err != nil {
			http.Error(w, "failed to encode response", http.StatusInternalServerError)
			return
		}
	}
}
