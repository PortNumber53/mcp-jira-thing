package httpserver

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/config"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

type stubUserClient struct{}

func (s *stubUserClient) ListUsers(ctx context.Context, limit int) ([]models.PublicUser, error) {
	return []models.PublicUser{{ID: "rec1"}}, nil
}

func (s *stubUserClient) UpsertGitHubUser(ctx context.Context, user models.GitHubAuthUser) error {
	return nil
}

func (s *stubUserClient) UpsertUserSettings(ctx context.Context, userEmail, baseURL, jiraEmail, apiKey string) error {
	return nil
}

func (s *stubUserClient) UpsertGoogleUser(ctx context.Context, user models.GoogleAuthUser) error {
	return nil
}

func (s *stubUserClient) ListUserSettings(ctx context.Context, email string) ([]models.JiraUserSettings, error) {
	return nil, nil
}

func (s *stubUserClient) GenerateMCPSecret(ctx context.Context, email string) (string, error) {
	return "dummy", nil
}

func (s *stubUserClient) GetMCPSecret(ctx context.Context, email string) (*string, error) {
	return nil, nil
}

func (s *stubUserClient) GetUserSettingsByMCPSecret(ctx context.Context, secret string) (*models.JiraUserSettingsWithSecret, error) {
	return nil, nil
}

func (s *stubUserClient) SaveSubscription(ctx context.Context, sub *models.Subscription) error {
	return nil
}

func (s *stubUserClient) GetSubscription(ctx context.Context, userEmail string) (*models.Subscription, error) {
	return nil, nil
}

func (s *stubUserClient) UpdateSubscription(ctx context.Context, sub *models.Subscription) error {
	return nil
}

func (s *stubUserClient) SavePayment(ctx context.Context, payment *models.PaymentHistory) error {
	return nil
}

func (s *stubUserClient) GetPaymentHistory(ctx context.Context, userEmail string) ([]models.PaymentHistory, error) {
	return nil, nil
}

func (s *stubUserClient) GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	return nil, nil
}

func (s *stubUserClient) GetConnectedAccounts(ctx context.Context, email string) ([]models.ConnectedAccount, error) {
	return nil, nil
}

func TestHealthRoute(t *testing.T) {
	cfg := config.Config{ServerAddress: ":0"}
	stub := &stubUserClient{}

	// Create a mock database connection
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("failed to open test database: %v", err)
	}
	defer db.Close()

	server := New(cfg, db, stub, stub, stub, stub, stub)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()

	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d", rr.Code)
	}
}
