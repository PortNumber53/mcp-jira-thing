package httpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/config"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

type stubUserClient struct{}

func (s *stubUserClient) ListUsers(ctx context.Context, limit int) ([]models.User, error) {
	return []models.User{{ID: "rec1"}}, nil
}

func (s *stubUserClient) UpsertGitHubUser(ctx context.Context, user models.GitHubAuthUser) error {
	return nil
}

func TestHealthRoute(t *testing.T) {
	cfg := config.Config{ServerAddress: ":0"}
	server := New(cfg, &stubUserClient{}, &stubUserClient{})

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()

	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d", rr.Code)
	}
}
