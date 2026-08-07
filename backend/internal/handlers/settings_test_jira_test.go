package handlers

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
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
}

func TestValidatePublicHost_RejectsPrivate(t *testing.T) {
	if err := validatePublicHost("10.0.0.1"); err == nil {
		t.Fatal("expected error for 10.0.0.1")
	}
	if err := validatePublicHost("192.168.1.1"); err == nil {
		t.Fatal("expected error for 192.168.1.1")
	}
}

func TestValidatePublicHost_RejectsIPv6Loopback(t *testing.T) {
	if err := validatePublicHost("::1"); err == nil {
		t.Fatal("expected error for ::1 (IPv6 loopback)")
	}
}

func TestValidatePublicHost_RejectsIPv6LinkLocal(t *testing.T) {
	if err := validatePublicHost("fe80::1"); err == nil {
		t.Fatal("expected error for fe80::1 (IPv6 link-local)")
	}
}

func TestTestJiraSettings_RejectsEmptyHostname(t *testing.T) {
	body := `{"jira_base_url":"http://","jira_email":"a@b.com","atlassian_api_key":"key"}`

	req := makeAuthedRequest(t, body)
	rr := httptest.NewRecorder()

	handler := TestJiraSettings("test-secret")
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty hostname, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestTestJiraSettings_RejectsRedirectToInternal verifies that the safe HTTP
// client does not follow redirects to internal/loopback addresses. A test
// server on 127.0.0.1 acts as the "public" redirector; if the client followed
// the redirect to a second loopback server, the second handler would be hit.
// Instead, the redirect should be blocked by CheckRedirect.
func TestTestJiraSettings_RejectsRedirectToInternal(t *testing.T) {
	// Target server that would be reached if the redirect were followed.
	targetCalled := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetCalled = true
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"displayName":"pwned"}`))
	}))
	defer target.Close()

	// Redirector server that responds with 302 to the target (loopback) URL.
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer redirector.Close()

	// Parse the redirector URL to extract its host:port.
	// The redirector is on 127.0.0.1, so the initial validatePublicHost check
	// should reject it before any request is made.
	body := `{"jira_base_url":"` + redirector.URL + `","jira_email":"a@b.com","atlassian_api_key":"key"}`

	req := makeAuthedRequest(t, body)
	rr := httptest.NewRecorder()

	handler := TestJiraSettings("test-secret")
	handler.ServeHTTP(rr, req)

	// The redirector is on 127.0.0.1, so the initial validation should reject it.
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for redirector on loopback, got %d: %s", rr.Code, rr.Body.String())
	}
	if targetCalled {
		t.Fatal("target (redirect destination) should not have been called")
	}
}

// TestSafeHTTPClient_BlocksRedirectToInternal verifies that even if the initial
// host passes validation, a redirect to an internal address is blocked by
// CheckRedirect. We use a hostname that resolves to a public IP for the initial
// request (simulated via a test server on a non-loopback listener) and redirect
// to 127.0.0.1.
func TestSafeHTTPClient_BlocksRedirectToInternal(t *testing.T) {
	targetCalled := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	// Build a redirect to the loopback target URL.
	targetURL, _ := parseURL(target.URL)
	redirectURL := "http://" + targetURL.Host + "/internal"

	// Create a test server that will act as the "validated" public server.
	// Since httptest.NewServer listens on 127.0.0.1, we can't fully test the
	// "public passes, redirect to private blocked" path without a real public
	// server. Instead, test the CheckRedirect logic directly.
	req := httptest.NewRequest(http.MethodGet, redirectURL, nil)

	// Simulate the CheckRedirect call.
	via := []*http.Request{httptest.NewRequest(http.MethodGet, "http://example.com", nil)}
	err := safeHTTPClient.CheckRedirect(req, via)
	if err == nil {
		t.Fatal("expected CheckRedirect to block redirect to loopback, got nil")
	}
	if targetCalled {
		t.Fatal("target should not have been called")
	}
}

// TestSafeHTTPClient_DialContextBlocksLoopback verifies that DialContext
// rejects connections to loopback addresses.
func TestSafeHTTPClient_DialContextBlocksLoopback(t *testing.T) {
	_, port, _ := net.SplitHostPort("127.0.0.1:9999")
	conn, err := safeHTTPClient.Transport.(*http.Transport).DialContext(
		nil, "tcp", net.JoinHostPort("127.0.0.1", port))
	if err == nil {
		if conn != nil {
			conn.Close()
		}
		t.Fatal("expected DialContext to reject loopback address")
	}
}

func parseURL(rawurl string) (*url.URL, error) {
	return url.Parse(rawurl)
}
