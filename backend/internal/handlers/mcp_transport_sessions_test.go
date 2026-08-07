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
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/store"
	"github.com/go-chi/chi/v5"
)

type fakeMCPTransportSessionStore struct {
	created  *models.MCPTransportSession
	existing map[string]bool
}

func (f *fakeMCPTransportSessionStore) CreateMCPTransportSession(_ context.Context, session *models.MCPTransportSession) error {
	if f.existing == nil {
		f.existing = make(map[string]bool)
	}
	f.created = session
	f.existing[session.SessionID] = true
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

func (f *fakeMCPTransportSessionStore) DeleteMCPTransportSession(_ context.Context, sessionID string) error {
	if f.existing == nil || !f.existing[sessionID] {
		return store.ErrMCPTransportSessionNotFound
	}
	delete(f.existing, sessionID)
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

func TestTouchMCPTransportSessionAcceptsEmptyBody(t *testing.T) {
	fakeStore := &fakeMCPTransportSessionStore{}
	router := chi.NewRouter()
	RegisterMCPTransportSessionRoutes(router, fakeStore, "internal-token")
	req := httptest.NewRequest(http.MethodPatch, "/internal/mcp/sessions/session-1", nil)
	req.Header.Set("X-MCP-Session-Token", "internal-token")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for empty PATCH body, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestTouchMCPTransportSessionRejectsInvalidJSON(t *testing.T) {
	fakeStore := &fakeMCPTransportSessionStore{}
	router := chi.NewRouter()
	RegisterMCPTransportSessionRoutes(router, fakeStore, "internal-token")
	req := httptest.NewRequest(http.MethodPatch, "/internal/mcp/sessions/session-1", bytes.NewBufferString(`{bad`))
	req.Header.Set("X-MCP-Session-Token", "internal-token")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid JSON, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestDeleteMCPTransportSessionReturns404ForMissingSession(t *testing.T) {
	fakeStore := &fakeMCPTransportSessionStore{}
	router := chi.NewRouter()
	RegisterMCPTransportSessionRoutes(router, fakeStore, "internal-token")
	req := httptest.NewRequest(http.MethodDelete, "/internal/mcp/sessions/missing", nil)
	req.Header.Set("X-MCP-Session-Token", "internal-token")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing session, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestDeleteMCPTransportSessionReturns204ForExistingSession(t *testing.T) {
	fakeStore := &fakeMCPTransportSessionStore{}
	router := chi.NewRouter()
	RegisterMCPTransportSessionRoutes(router, fakeStore, "internal-token")

	createBody, _ := json.Marshal(map[string]any{
		"session_id": "session-1",
		"transport":  models.MCPTransportStreamableHTTP,
	})
	createReq := httptest.NewRequest(http.MethodPost, "/internal/mcp/sessions/", bytes.NewReader(createBody))
	createReq.Header.Set("X-MCP-Session-Token", "internal-token")
	createRR := httptest.NewRecorder()
	router.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("setup create failed: %d %s", createRR.Code, createRR.Body.String())
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/internal/mcp/sessions/session-1", nil)
	deleteReq.Header.Set("X-MCP-Session-Token", "internal-token")
	deleteRR := httptest.NewRecorder()
	router.ServeHTTP(deleteRR, deleteReq)
	if deleteRR.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for existing session, got %d: %s", deleteRR.Code, deleteRR.Body.String())
	}
}
