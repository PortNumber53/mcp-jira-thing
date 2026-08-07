package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/session"
)

// makeAuthedRequest creates a POST request with a valid session cookie
// and the given JSON body.
func makeAuthedRequest(t *testing.T, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/settings/jira/test", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	secret := "test-secret"
	payload := session.Payload{
		Login: "testuser",
		ID:    1,
		Exp:   time.Now().Add(time.Hour).Unix(),
	}
	token, err := session.Encode(secret, payload)
	if err != nil {
		t.Fatalf("session.Encode: %v", err)
	}
	req.AddCookie(&http.Cookie{Name: session.SessionCookie, Value: token})
	return req
}

func TestTestJiraSettings_RejectsLoopbackURL(t *testing.T) {
	body := `{"jira_base_url":"http://127.0.0.1:8080","jira_email":"a@b.com","atlassian_api_key":"key"}`

	req := makeAuthedRequest(t, body)
	rr := httptest.NewRecorder()

	handler := TestJiraSettings("test-secret")
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for loopback URL, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !strings.Contains(resp["error"].(string), "private") {
		t.Fatalf("expected error about private address, got: %v", resp["error"])
	}
}

func TestTestJiraSettings_RejectsMetadataServiceURL(t *testing.T) {
	// 169.254.169.254 is the AWS/cloud metadata endpoint (link-local)
	body := `{"jira_base_url":"http://169.254.169.254/latest/meta-data","jira_email":"a@b.com","atlassian_api_key":"key"}`

	req := makeAuthedRequest(t, body)
	rr := httptest.NewRecorder()

	handler := TestJiraSettings("test-secret")
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for metadata URL, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestTestJiraSettings_RejectsNonHTTPScheme(t *testing.T) {
	body := `{"jira_base_url":"file:///etc/passwd","jira_email":"a@b.com","atlassian_api_key":"key"}`

	req := makeAuthedRequest(t, body)
	rr := httptest.NewRecorder()

	handler := TestJiraSettings("test-secret")
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for file:// scheme, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestTestJiraSettings_RejectsMissingFields(t *testing.T) {
	body := `{"jira_base_url":"","jira_email":"a@b.com","atlassian_api_key":"key"}`

	req := makeAuthedRequest(t, body)
	rr := httptest.NewRecorder()

	handler := TestJiraSettings("test-secret")
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing fields, got %d", rr.Code)
	}
}

func TestTestJiraSettings_RejectsUnauthenticatedRequest(t *testing.T) {
	body := `{"jira_base_url":"https://example.atlassian.net","jira_email":"a@b.com","atlassian_api_key":"key"}`

	req := httptest.NewRequest(http.MethodPost, "/api/settings/jira/test", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	handler := TestJiraSettings("test-secret")
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated request, got %d", rr.Code)
	}
}

func TestValidatePublicHost_RejectsLoopback(t *testing.T) {
	if err := validatePublicHost("127.0.0.1"); err == nil {
		t.Fatal("expected error for 127.0.0.1")
	}
	if err := validatePublicHost("localhost"); err == nil {
		t.Fatal("expected error for localhost")
	}
}

func TestValidatePublicHost_RejectsPrivate(t *testing.T) {
	if err := validatePublicHost("10.0.0.1"); err == nil {
		t.Fatal("expected error for 10.0.0.1")
	}
	if err := validatePublicHost("192.168.1.1"); err == nil {
		t.Fatal("expected error for 192.168.1.1")
	}
}
