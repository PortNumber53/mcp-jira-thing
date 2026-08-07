package handlers

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/store"
	"github.com/go-chi/chi/v5"
)

const (
	defaultMCPTransportSessionTTL = 24 * time.Hour
	maxMCPTransportSessionTTL     = 7 * 24 * time.Hour
)

type MCPTransportSessionStore interface {
	CreateMCPTransportSession(context.Context, *models.MCPTransportSession) error
	GetMCPTransportSession(context.Context, string) (*models.MCPTransportSession, error)
	TouchMCPTransportSession(context.Context, string, time.Time) error
	DeleteMCPTransportSession(context.Context, string) error
	GetUserIDByMCPSecret(context.Context, string) (int64, error)
}

type createMCPTransportSessionRequest struct {
	SessionID   string          `json:"session_id"`
	Transport   string          `json:"transport"`
	MCPSecret   string          `json:"mcp_secret,omitempty"`
	InitRequest json.RawMessage `json:"init_request,omitempty"`
	TTLSeconds  int64           `json:"ttl_seconds,omitempty"`
}

type touchMCPTransportSessionRequest struct {
	TTLSeconds int64 `json:"ttl_seconds,omitempty"`
}

func RegisterMCPTransportSessionRoutes(router chi.Router, sessionStore MCPTransportSessionStore, apiToken string) {
	router.Route("/internal/mcp/sessions", func(r chi.Router) {
		r.Use(requireMCPTransportSessionToken(apiToken))
		r.Post("/", createMCPTransportSession(sessionStore))
		r.Get("/{sessionID}", getMCPTransportSession(sessionStore))
		r.Patch("/{sessionID}", touchMCPTransportSession(sessionStore))
		r.Delete("/{sessionID}", deleteMCPTransportSession(sessionStore))
	})
}

func requireMCPTransportSessionToken(expected string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if expected == "" {
				http.Error(w, "MCP session API token is not configured", http.StatusServiceUnavailable)
				return
			}

			provided := strings.TrimSpace(r.Header.Get("X-MCP-Session-Token"))
			if provided == "" {
				provided = strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
			}
			if len(provided) != len(expected) || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func createMCPTransportSession(sessionStore MCPTransportSessionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload createMCPTransportSessionRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON payload"})
			return
		}

		payload.SessionID = strings.TrimSpace(payload.SessionID)
		if payload.SessionID == "" || len(payload.SessionID) > 200 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid session_id"})
			return
		}
		if payload.Transport != models.MCPTransportSSE && payload.Transport != models.MCPTransportStreamableHTTP {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid transport"})
			return
		}
		if len(payload.InitRequest) > 0 && !json.Valid(payload.InitRequest) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "init_request must be valid JSON"})
			return
		}

		var userID *int64
		if payload.MCPSecret != "" {
			resolvedUserID, err := sessionStore.GetUserIDByMCPSecret(r.Context(), payload.MCPSecret)
			if err != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid MCP secret"})
				return
			}
			userID = &resolvedUserID
		}

		ttl := mcpTransportSessionTTL(payload.TTLSeconds)
		session := &models.MCPTransportSession{
			SessionID:   payload.SessionID,
			Transport:   payload.Transport,
			UserID:      userID,
			InitRequest: payload.InitRequest,
			ExpiresAt:   time.Now().UTC().Add(ttl),
		}
		if err := sessionStore.CreateMCPTransportSession(r.Context(), session); err != nil {
			log.Printf("create MCP transport session: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to create MCP transport session"})
			return
		}

		created, err := sessionStore.GetMCPTransportSession(r.Context(), session.SessionID)
		if err != nil {
			log.Printf("load created MCP transport session: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to load MCP transport session"})
			return
		}

		writeJSON(w, http.StatusCreated, created)
	}
}

func getMCPTransportSession(sessionStore MCPTransportSessionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := sessionStore.GetMCPTransportSession(r.Context(), chi.URLParam(r, "sessionID"))
		if errors.Is(err, store.ErrMCPTransportSessionNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "session not found"})
			return
		}
		if err != nil {
			log.Printf("get MCP transport session: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to load MCP transport session"})
			return
		}

		writeJSON(w, http.StatusOK, session)
	}
}

func touchMCPTransportSession(sessionStore MCPTransportSessionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload touchMCPTransportSessionRequest
		if r.Body != nil {
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON payload"})
				return
			}
		}

		expiresAt := time.Now().UTC().Add(mcpTransportSessionTTL(payload.TTLSeconds))
		err := sessionStore.TouchMCPTransportSession(r.Context(), chi.URLParam(r, "sessionID"), expiresAt)
		if errors.Is(err, store.ErrMCPTransportSessionNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "session not found"})
			return
		}
		if err != nil {
			log.Printf("touch MCP transport session: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to touch MCP transport session"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"session_id": chi.URLParam(r, "sessionID"), "expires_at": expiresAt})
	}
}

func deleteMCPTransportSession(sessionStore MCPTransportSessionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := sessionStore.DeleteMCPTransportSession(r.Context(), chi.URLParam(r, "sessionID"))
		if errors.Is(err, store.ErrMCPTransportSessionNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "session not found"})
			return
		}
		if err != nil {
			log.Printf("delete MCP transport session: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to delete MCP transport session"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func mcpTransportSessionTTL(seconds int64) time.Duration {
	if seconds <= 0 {
		return defaultMCPTransportSessionTTL
	}
	if seconds > int64(maxMCPTransportSessionTTL/time.Second) {
		return maxMCPTransportSessionTTL
	}
	ttl := time.Duration(seconds) * time.Second
	if ttl > maxMCPTransportSessionTTL {
		return maxMCPTransportSessionTTL
	}
	return ttl
}
