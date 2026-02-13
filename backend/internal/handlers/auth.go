package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

// OAuthStore defines the behaviour required from the storage client used
// by the OAuth handlers.
type OAuthStore interface {
	UpsertGitHubUser(ctx context.Context, user models.GitHubAuthUser) error
	UpsertGoogleUser(ctx context.Context, user models.GoogleAuthUser) error
	GetConnectedAccounts(ctx context.Context, email string) ([]models.ConnectedAccount, error)
}

// GitHubAuth accepts GitHub OAuth login data (forwarded from the frontend
// Worker) and persists it into the local database for multi-tenant Jira
// configuration.
func GitHubAuth(store OAuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		reqID := middleware.GetReqID(r.Context())
		log.Printf("GitHubAuth: request received (req_id=%s, method=%s, content_length=%d)", reqID, r.Method, r.ContentLength)

		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var payload models.GitHubAuthUser
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			log.Printf("GitHubAuth: invalid JSON payload (req_id=%s): %v", reqID, err)
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}

		if payload.GitHubID == 0 || payload.Login == "" || payload.AccessToken == "" {
			log.Printf("GitHubAuth: missing required fields (req_id=%s, github_id=%d, login=%q, access_token_empty=%t)",
				reqID, payload.GitHubID, payload.Login, payload.AccessToken == "")
			http.Error(w, "missing required fields", http.StatusBadRequest)
			return
		}

		if err := store.UpsertGitHubUser(r.Context(), payload); err != nil {
			log.Printf("GitHubAuth: failed to persist GitHub user (req_id=%s, github_id=%d, login=%s): %v", reqID, payload.GitHubID, payload.Login, err)
			http.Error(w, "failed to persist GitHub user", http.StatusBadGateway)
			return
		}

		log.Printf("GitHubAuth: successfully upserted GitHub user (req_id=%s, github_id=%d, login=%s)", reqID, payload.GitHubID, payload.Login)

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{"ok": true}); err != nil {
			http.Error(w, "failed to encode response", http.StatusInternalServerError)
			return
		}
	}
}

// GoogleAuth accepts Google OAuth login data (forwarded from the frontend
// Worker) and persists it into the local database for multi-tenant Jira
// configuration.
func GoogleAuth(store OAuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		reqID := middleware.GetReqID(r.Context())
		log.Printf("GoogleAuth: request received (req_id=%s, method=%s, content_length=%d)", reqID, r.Method, r.ContentLength)

		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var payload models.GoogleAuthUser
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			log.Printf("GoogleAuth: invalid JSON payload (req_id=%s): %v", reqID, err)
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}

		if payload.Sub == "" || payload.AccessToken == "" {
			log.Printf("GoogleAuth: missing required fields (req_id=%s, sub=%q, access_token_empty=%t)",
				reqID, payload.Sub, payload.AccessToken == "")
			http.Error(w, "missing required fields", http.StatusBadRequest)
			return
		}

		email := ""
		if payload.Email != nil {
			email = *payload.Email
		}

		if err := store.UpsertGoogleUser(r.Context(), payload); err != nil {
			log.Printf("GoogleAuth: failed to persist Google user (req_id=%s, sub=%q, email=%q): %v", reqID, payload.Sub, email, err)
			http.Error(w, "failed to persist Google user", http.StatusBadGateway)
			return
		}

		log.Printf("GoogleAuth: successfully upserted Google user (req_id=%s, sub=%q, email=%q)", reqID, payload.Sub, email)

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{"ok": true}); err != nil {
			http.Error(w, "failed to encode response", http.StatusInternalServerError)
			return
		}
	}
}

// ConnectedAccounts returns the list of OAuth providers connected to the user.
func ConnectedAccounts(store OAuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		email := r.URL.Query().Get("email")
		if email == "" {
			http.Error(w, "email parameter is required", http.StatusBadRequest)
			return
		}

		accounts, err := store.GetConnectedAccounts(r.Context(), email)
		if err != nil {
			log.Printf("ConnectedAccounts: failed to get connected accounts for %q: %v", email, err)
			http.Error(w, "failed to get connected accounts", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{"connected_accounts": accounts}); err != nil {
			http.Error(w, "failed to encode response", http.StatusInternalServerError)
			return
		}
	}
}
