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
	GitHubID   int64   `json:"github_id"`
	Login      string  `json:"login"`
	Name       *string `json:"name,omitempty"`
	Email      *string `json:"email,omitempty"`
	AvatarURL  *string `json:"avatar_url,omitempty"`
	AccessToken string `json:"access_token"`
	Scope      *string `json:"scope,omitempty"`
}
