package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/session"
)

type mcpSecretPayload struct {
	UserEmail string `json:"user_email"`
}

// MCPSecret creates an HTTP handler that allows a user to fetch or rotate
// their MCP tenant secret, which is used to identify the tenant when an MCP
// client connects. It reads the session cookie to identify the user, falling
// back to the request body/query param for backward compatibility.
func MCPSecret(store UserSettingsStore, cookieSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionEmail := ""
		if sess, err := session.ReadSession(r, cookieSecret); err == nil && sess.Email != nil {
			sessionEmail = *sess.Email
		}

		switch r.Method {
		case http.MethodPost:
			email := sessionEmail
			if email == "" {
				var payload mcpSecretPayload
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					log.Printf("MCPSecret: invalid JSON payload: %v", err)
					http.Error(w, "invalid JSON payload", http.StatusBadRequest)
					return
				}
				email = strings.TrimSpace(payload.UserEmail)
			}

			if email == "" {
				http.Error(w, "not authenticated", http.StatusUnauthorized)
				return
			}

			secret, err := store.GenerateMCPSecret(r.Context(), email)
			if err != nil {
				log.Printf("MCPSecret: failed to generate secret for email=%s: %v", email, err)
				http.Error(w, "failed to generate MCP secret", http.StatusBadGateway)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(map[string]any{"mcp_secret": secret}); err != nil {
				http.Error(w, "failed to encode response", http.StatusInternalServerError)
				return
			}
		case http.MethodGet:
			email := sessionEmail
			if email == "" {
				email = strings.TrimSpace(r.URL.Query().Get("email"))
			}
			if email == "" {
				http.Error(w, "not authenticated", http.StatusUnauthorized)
				return
			}

			secret, err := store.GetMCPSecret(r.Context(), email)
			if err != nil {
				log.Printf("MCPSecret: failed to get secret for email=%s: %v", email, err)
				http.Error(w, "failed to load MCP secret", http.StatusBadGateway)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(map[string]any{"mcp_secret": secret}); err != nil {
				http.Error(w, "failed to encode response", http.StatusInternalServerError)
				return
			}
		default:
			w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPost}, ", "))
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}
