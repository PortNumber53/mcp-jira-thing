package models

// User represents a sanitized view of a user record exposed by the backend API.
type User struct {
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
	AtlassianAPIToken string `json:"atlassian_api_key"`
}
