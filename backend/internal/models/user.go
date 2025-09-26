package models

// User represents a sanitized view of a NextAuth user stored in Xata.
type User struct {
	ID    string  `json:"id"`
	Email *string `json:"email,omitempty"`
	Name  *string `json:"name,omitempty"`
	Image *string `json:"image,omitempty"`
}
