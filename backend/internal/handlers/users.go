package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

const defaultUserPageSize = 50

// UserLister defines the behaviour required from the storage client backing the users handler.
type UserLister interface {
	ListUsers(rCtx context.Context, limit int) ([]models.PublicUser, error)
}

// Users creates an HTTP handler that returns a list of users from the primary database.
func Users(client UserLister) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		limit := defaultUserPageSize
		if override := r.URL.Query().Get("limit"); override != "" {
			if parsed, err := strconv.Atoi(override); err == nil && parsed > 0 {
				limit = parsed
			}
		}

		users, err := client.ListUsers(ctx, limit)
		if err != nil {
			http.Error(w, "failed to load users", http.StatusBadGateway)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{"users": users}); err != nil {
			http.Error(w, "failed to encode response", http.StatusInternalServerError)
		}
	}
}
