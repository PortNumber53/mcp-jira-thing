package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

// IntegrationTokenStore defines the behaviour required from the storage client
// backing the integration tokens handler.
type IntegrationTokenStore interface {
	UpsertIntegrationToken(ctx context.Context, userEmail, provider, accessToken string, refreshToken *string, tokenType string, expiresAt *string, scopes *string, metadata *string) error
	ListIntegrationTokens(ctx context.Context, email string) ([]models.IntegrationTokenPublic, error)
	GetIntegrationToken(ctx context.Context, email, provider string) (*models.IntegrationToken, error)
	GetIntegrationTokenByMCPSecret(ctx context.Context, secret, provider string) (*models.IntegrationToken, error)
	DeleteIntegrationToken(ctx context.Context, email, provider string) error
}

type integrationTokenPayload struct {
	UserEmail    string  `json:"user_email"`
	Provider     string  `json:"provider"`
	AccessToken  string  `json:"access_token"`
	RefreshToken *string `json:"refresh_token,omitempty"`
	TokenType    string  `json:"token_type"`
	ExpiresAt    *string `json:"expires_at,omitempty"`
	Scopes       *string `json:"scopes,omitempty"`
	Metadata     *string `json:"metadata,omitempty"`
}

// IntegrationTokens creates an HTTP handler for managing integration tokens.
// GET  ?email=...            → list all tokens for user (public view)
// POST                       → upsert a token
// DELETE ?email=...&provider= → remove a token
func IntegrationTokens(store IntegrationTokenStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			email := strings.TrimSpace(r.URL.Query().Get("email"))
			if email == "" {
				http.Error(w, "email query parameter is required", http.StatusBadRequest)
				return
			}

			tokens, err := store.ListIntegrationTokens(r.Context(), email)
			if err != nil {
				log.Printf("IntegrationTokens: failed to list tokens for email=%s: %v", email, err)
				http.Error(w, "failed to load integration tokens", http.StatusBadGateway)
				return
			}

			if tokens == nil {
				tokens = []models.IntegrationTokenPublic{}
			}

			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(map[string]any{"integrations": tokens}); err != nil {
				http.Error(w, "failed to encode response", http.StatusInternalServerError)
			}

		case http.MethodPost:
			var payload integrationTokenPayload
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				log.Printf("IntegrationTokens: invalid JSON payload: %v", err)
				http.Error(w, "invalid JSON payload", http.StatusBadRequest)
				return
			}

			if payload.UserEmail == "" || payload.Provider == "" || payload.AccessToken == "" {
				http.Error(w, "user_email, provider, and access_token are required", http.StatusBadRequest)
				return
			}

			if payload.TokenType == "" {
				payload.TokenType = "Bearer"
			}

			if err := store.UpsertIntegrationToken(
				r.Context(),
				payload.UserEmail,
				payload.Provider,
				payload.AccessToken,
				payload.RefreshToken,
				payload.TokenType,
				payload.ExpiresAt,
				payload.Scopes,
				payload.Metadata,
			); err != nil {
				log.Printf("IntegrationTokens: failed to upsert token for email=%s provider=%s: %v",
					payload.UserEmail, payload.Provider, err)
				http.Error(w, "failed to save integration token", http.StatusBadGateway)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(map[string]any{"ok": true}); err != nil {
				http.Error(w, "failed to encode response", http.StatusInternalServerError)
			}

		case http.MethodDelete:
			email := strings.TrimSpace(r.URL.Query().Get("email"))
			provider := strings.TrimSpace(r.URL.Query().Get("provider"))
			if email == "" || provider == "" {
				http.Error(w, "email and provider query parameters are required", http.StatusBadRequest)
				return
			}

			if err := store.DeleteIntegrationToken(r.Context(), email, provider); err != nil {
				log.Printf("IntegrationTokens: failed to delete token for email=%s provider=%s: %v", email, provider, err)
				http.Error(w, "failed to delete integration token", http.StatusBadGateway)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(map[string]any{"ok": true}); err != nil {
				http.Error(w, "failed to encode response", http.StatusInternalServerError)
			}

		default:
			w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPost, http.MethodDelete}, ", "))
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

// TenantIntegrationToken exposes a backend-only API that allows trusted callers
// (such as the MCP Worker) to resolve integration tokens for a tenant using the
// per-tenant mcp_secret. This endpoint returns the access token and therefore
// MUST NOT be called from the public frontend.
func TenantIntegrationToken(store IntegrationTokenStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		secret := strings.TrimSpace(r.URL.Query().Get("mcp_secret"))
		provider := strings.TrimSpace(r.URL.Query().Get("provider"))
		if secret == "" || provider == "" {
			http.Error(w, "mcp_secret and provider query parameters are required", http.StatusBadRequest)
			return
		}

		token, err := store.GetIntegrationTokenByMCPSecret(r.Context(), secret, provider)
		if err != nil {
			log.Printf("TenantIntegrationToken: failed to resolve token by mcp_secret for provider=%s: %v", provider, err)
			http.Error(w, "failed to resolve integration token", http.StatusBadGateway)
			return
		}

		if token == nil {
			http.Error(w, "no integration token found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(token); err != nil {
			http.Error(w, "failed to encode response", http.StatusInternalServerError)
		}
	}
}
