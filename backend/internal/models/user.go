package models

import "time"

// User represents a sanitized view of a user record exposed by the backend API.
type User struct {
	ID        int64      `json:"id"`
	Login     string     `json:"login"`
	Email     *string    `json:"email,omitempty"`
	Name      *string    `json:"name,omitempty"`
	AvatarURL *string    `json:"avatar_url,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// PublicUser represents the external API view of a user with string ID
type PublicUser struct {
	ID    string  `json:"id"`
	Email *string `json:"email,omitempty"`
	Name  *string `json:"name,omitempty"`
	Image *string `json:"image,omitempty"`
}

// GitHubAuthUser captures the data produced during a GitHub OAuth login that we
// want to persist in our own database for multi-tenant management.
type GitHubAuthUser struct {
	GitHubID    int64   `json:"github_id"`
	Login       string  `json:"login"`
	Name        *string `json:"name,omitempty"`
	Email       *string `json:"email,omitempty"`
	AvatarURL   *string `json:"avatar_url,omitempty"`
	AccessToken string  `json:"access_token"`
	Scope       *string `json:"scope,omitempty"`
}

// GoogleAuthUser captures the data produced during a Google OAuth login that we
// want to persist in our own database for multi-tenant management.
type GoogleAuthUser struct {
	Sub         string  `json:"sub"`
	Name        *string `json:"name,omitempty"`
	Email       *string `json:"email,omitempty"`
	AvatarURL   *string `json:"avatar_url,omitempty"`
	AccessToken string  `json:"access_token"`
}

// JiraUserSettings represents a non-sensitive view of Jira settings associated
// with a user that can be safely returned to the frontend.
type JiraUserSettings struct {
	JiraBaseURL string  `json:"jira_base_url"`
	JiraEmail   string  `json:"jira_email"`
	JiraCloudID *string `json:"jira_cloud_id,omitempty"`
	IsDefault   bool    `json:"is_default"`
}

// JiraUserSettingsWithSecret is the internal representation of Jira settings
// that includes the sensitive Atlassian API token. This should only be
// returned to trusted server-side callers (e.g. the MCP Worker) and never to
// the public frontend.
type JiraUserSettingsWithSecret struct {
	JiraBaseURL      string  `json:"jira_base_url"`
	JiraEmail        string  `json:"jira_email"`
	JiraCloudID      *string `json:"jira_cloud_id,omitempty"`
	IsDefault        bool    `json:"is_default"`
	AtlassianAPIToken string  `json:"atlassian_api_key"`
}

// Request represents an API request made by a user for tracking usage metrics
type Request struct {
	ID                string  `json:"id"`
	UserID            string  `json:"user_id"`
	Method            string  `json:"method"`
	Endpoint          string  `json:"endpoint"`
	StatusCode        int     `json:"status_code"`
	ResponseTimeMs    *int    `json:"response_time_ms,omitempty"`
	RequestSizeBytes  *int    `json:"request_size_bytes,omitempty"`
	ResponseSizeBytes *int    `json:"response_size_bytes,omitempty"`
	ErrorMessage      *string `json:"error_message,omitempty"`
	CreatedAt         string  `json:"created_at"`
}

// RequestMetrics represents aggregated usage metrics for a user
type RequestMetrics struct {
	UserID            string `json:"user_id"`
	TotalRequests     int    `json:"total_requests"`
	SuccessRequests   int    `json:"success_requests"`
	ErrorRequests     int    `json:"error_requests"`
	AvgResponseTimeMs int    `json:"avg_response_time_ms"`
	TotalBytes        int    `json:"total_bytes"`
	LastRequestAt     string `json:"last_request_at"`
}

// ConnectedAccount represents an OAuth provider connected to a user account
type ConnectedAccount struct {
	Provider          string    `json:"provider"`
	ProviderAccountID string    `json:"provider_account_id"`
	AvatarURL         *string   `json:"avatar_url,omitempty"`
	ConnectedAt       time.Time `json:"connected_at"`
}
