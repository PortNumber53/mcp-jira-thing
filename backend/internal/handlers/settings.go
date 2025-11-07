package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

// UserSettingsStore defines the behaviour required from the storage client
// backing the Jira user settings handler.
type UserSettingsStore interface {
	UpsertUserSettings(ctx context.Context, email, baseURL, apiKey string) error
	ListUserSettings(ctx context.Context, email string) ([]models.JiraUserSettings, error)
}

type jiraSettingsPayload struct {
	JiraBaseURL     string `json:"jira_base_url"`
	JiraEmail       string `json:"jira_email"`
	AtlassianAPIKey string `json:"atlassian_api_key"`
}

// UserSettings creates an HTTP handler that upserts Jira settings for a user.
// The calling layer (e.g. the SPA Worker) is responsible for providing the
// authenticated GitHub ID in the payload.
func UserSettings(store UserSettingsStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			var payload jiraSettingsPayload
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				log.Printf("UserSettings: invalid JSON payload: %v", err)
				http.Error(w, "invalid JSON payload", http.StatusBadRequest)
				return
			}

			if payload.JiraBaseURL == "" || payload.JiraEmail == "" || payload.AtlassianAPIKey == "" {
				log.Printf("UserSettings: missing required fields (base_url=%q, email=%q, api_key_empty=%t)",
					payload.JiraBaseURL, payload.JiraEmail, payload.AtlassianAPIKey == "")
				http.Error(w, "missing required fields", http.StatusBadRequest)
				return
			}

			if err := store.UpsertUserSettings(r.Context(), payload.JiraEmail, payload.JiraBaseURL, payload.AtlassianAPIKey); err != nil {
				log.Printf("UserSettings: failed to persist settings for email=%s: %v", payload.JiraEmail, err)
				http.Error(w, "failed to persist Jira settings", http.StatusBadGateway)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(map[string]any{"ok": true}); err != nil {
				http.Error(w, "failed to encode response", http.StatusInternalServerError)
				return
			}
		case http.MethodGet:
			email := strings.TrimSpace(r.URL.Query().Get("email"))
			if email == "" {
				http.Error(w, "email query parameter is required", http.StatusBadRequest)
				return
			}

			settings, err := store.ListUserSettings(r.Context(), email)
			if err != nil {
				log.Printf("UserSettings: failed to list settings for email=%s: %v", email, err)
				http.Error(w, "failed to load Jira settings", http.StatusBadGateway)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(map[string]any{"settings": settings}); err != nil {
				http.Error(w, "failed to encode response", http.StatusInternalServerError)
				return
			}
		default:
			w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPost}, ", "))
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}
