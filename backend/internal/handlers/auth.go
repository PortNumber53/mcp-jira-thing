package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

// GitHubAuthStore defines the behaviour required from the storage client used
// by the GitHubAuth handler.
type GitHubAuthStore interface {
	UpsertGitHubUser(ctx context.Context, user models.GitHubAuthUser) error
}

// GitHubAuth accepts GitHub OAuth login data (forwarded from the frontend
// Worker) and persists it into the local database for multi-tenant Jira
// configuration.
func GitHubAuth(store GitHubAuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var payload models.GitHubAuthUser
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			log.Printf("GitHubAuth: invalid JSON payload: %v", err)
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}

		if payload.GitHubID == 0 || payload.Login == "" || payload.AccessToken == "" {
			log.Printf("GitHubAuth: missing required fields (github_id=%d, login=%q, access_token_empty=%t)",
				payload.GitHubID, payload.Login, payload.AccessToken == "")
			http.Error(w, "missing required fields", http.StatusBadRequest)
			return
		}

		if err := store.UpsertGitHubUser(r.Context(), payload); err != nil {
			log.Printf("GitHubAuth: failed to persist GitHub user %d (%s): %v", payload.GitHubID, payload.Login, err)
			http.Error(w, "failed to persist GitHub user", http.StatusBadGateway)
			return
		}

		log.Printf("GitHubAuth: successfully upserted GitHub user %d (%s)", payload.GitHubID, payload.Login)

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{"ok": true}); err != nil {
			http.Error(w, "failed to encode response", http.StatusInternalServerError)
			return
		}
	}
}
