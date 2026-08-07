package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
	"github.com/go-chi/chi/v5"
)

type fakeMCPTransportSessionStore struct {
	created *models.MCPTransportSession
}

func (f *fakeMCPTransportSessionStore) CreateMCPTransportSession(_ context.Context, session *models.MCPTransportSession) error {
	f.created = session
	now := time.Now().UTC()
	session.CreatedAt, session.UpdatedAt, session.LastSeenAt = now, now, now
	return nil
}

func (f *fakeMCPTransportSessionStore) GetMCPTransportSession(_ context.Context, _ string) (*models.MCPTransportSession, error) {
	login, email, secret := "octocat", "cat@example.com", "mcp-secret"
	f.created.UserLogin, f.created.UserEmail, f.created.MCPSecret = &login, &email, &secret
	return f.created, nil
}

func (f *fakeMCPTransportSessionStore) TouchMCPTransportSession(context.Context, string, time.Time) error {
	return nil
}

func (f *fakeMCPTransportSessionStore) DeleteMCPTransportSession(context.Context, string) error {
	return nil
}

func (f *fakeMCPTransportSessionStore) GetUserIDByMCPSecret(_ context.Context, secret string) (int64, error) {
	return 42, nil
}

func TestCreateMCPTransportSessionRequiresInternalToken(t *testing.T) {
	router := chi.NewRouter()
	RegisterMCPTransportSessionRoutes(router, &fakeMCPTransportSessionStore{}, "internal-token")
	req := httptest.NewRequest(http.MethodPost, "/internal/mcp/sessions/", bytes.NewBufferString(`{}`))
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestCreateMCPTransportSession(t *testing.T) {
	fakeStore := &fakeMCPTransportSessionStore{}
	router := chi.NewRouter()
	RegisterMCPTransportSessionRoutes(router, fakeStore, "internal-token")
	payload := map[string]any{
		"session_id":   "session-1",
		"transport":    models.MCPTransportStreamableHTTP,
		"mcp_secret":   "mcp-secret",
		"init_request": map[string]any{"method": "initialize"},
		"ttl_seconds":  60,
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/internal/mcp/sessions/", bytes.NewReader(body))
	req.Header.Set("X-MCP-Session-Token", "internal-token")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	if fakeStore.created == nil || fakeStore.created.UserID == nil || *fakeStore.created.UserID != 42 {
		t.Fatalf("session was not associated with the resolved user: %+v", fakeStore.created)
	}
}

func TestMCPTransportSessionTTLCapsWithoutOverflow(t *testing.T) {
	if got := mcpTransportSessionTTL(int64(^uint64(0) >> 1)); got != maxMCPTransportSessionTTL {
		t.Fatalf("expected max TTL %v, got %v", maxMCPTransportSessionTTL, got)
	}
}
