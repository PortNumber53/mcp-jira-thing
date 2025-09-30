package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

type mockUserClient struct {
	lastLimit int
	users     []models.User
	err       error
}

func (m *mockUserClient) ListUsers(ctx context.Context, limit int) ([]models.User, error) {
	m.lastLimit = limit
	return m.users, m.err
}

func TestUsersHandler(t *testing.T) {
	client := &mockUserClient{
		users: []models.User{{ID: "rec1"}},
	}

	req := httptest.NewRequest(http.MethodGet, "/users?limit=5", nil)
	rr := httptest.NewRecorder()

	handler := Users(client)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", rr.Code)
	}

	if client.lastLimit != 5 {
		t.Fatalf("expected limit 5 got %d", client.lastLimit)
	}
}
