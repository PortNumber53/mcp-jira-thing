package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/session"
)

type jiraTestPayload struct {
	JiraBaseURL     string `json:"jira_base_url"`
	JiraEmail       string `json:"jira_email"`
	AtlassianAPIKey string `json:"atlassian_api_key"`
}

// TestJiraSettings tests Jira credentials by calling /rest/api/3/myself (falling
// back to /rest/api/2/myself). Returns the authenticated Jira profile on success.
func TestJiraSettings(cookieSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := session.ReadSession(r, cookieSecret); err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "Not authenticated"})
			return
		}

		var payload jiraTestPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Invalid JSON payload"})
			return
		}

		if payload.JiraBaseURL == "" || payload.JiraEmail == "" || payload.AtlassianAPIKey == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Missing required fields"})
			return
		}

		parsedURL, err := url.Parse(payload.JiraBaseURL)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Invalid Jira base URL"})
			return
		}

		if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Jira base URL must use http or https scheme"})
			return
		}

		if err := validatePublicHost(parsedURL.Hostname()); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
			return
		}

		baseURL := strings.TrimRight(parsedURL.String(), "/")
		basicToken := base64.StdEncoding.EncodeToString([]byte(payload.JiraEmail + ":" + payload.AtlassianAPIKey))

		makeRequest := func(path string) (*http.Response, error) {
			req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, baseURL+path, nil)
			if err != nil {
				return nil, err
			}
			req.Header.Set("Accept", "application/json")
			req.Header.Set("Authorization", "Basic "+basicToken)
			return http.DefaultClient.Do(req)
		}

		resp, err := makeRequest("/rest/api/3/myself")
		if err != nil {
			log.Printf("TestJiraSettings: request failed: %v", err)
			writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": fmt.Sprintf("Request failed: %v", err)})
			return
		}
		defer resp.Body.Close()

		// Fall back to API v2 if v3 returns 404
		if resp.StatusCode == http.StatusNotFound {
			resp.Body.Close()
			resp, err = makeRequest("/rest/api/2/myself")
			if err != nil {
				log.Printf("TestJiraSettings: v2 fallback failed: %v", err)
				writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": fmt.Sprintf("Request failed: %v", err)})
				return
			}
			defer resp.Body.Close()
		}

		body, _ := io.ReadAll(resp.Body)

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			log.Printf("TestJiraSettings: Jira returned %d: %s", resp.StatusCode, string(body)[:min(len(body), 500)])
			writeJSON(w, resp.StatusCode, map[string]any{
				"ok":     false,
				"status": resp.StatusCode,
				"error":  string(body),
			})
			return
		}

		var profile map[string]any
		json.Unmarshal(body, &profile)

		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true,
			"account": map[string]any{
				"displayName":  profile["displayName"],
				"accountId":    profile["accountId"],
				"emailAddress": profile["emailAddress"],
			},
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// validatePublicHost checks that a hostname does not resolve to a private,
// loopback, or link-local address, preventing SSRF attacks where an
// authenticated user supplies an internal URL as the Jira base URL.
func validatePublicHost(hostname string) error {
	ips, err := net.LookupIP(hostname)
	if err != nil {
		return fmt.Errorf("Unable to resolve hostname: %v", err)
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return fmt.Errorf("Jira base URL must not point to a private, loopback, or link-local address")
		}
	}
	return nil
}
