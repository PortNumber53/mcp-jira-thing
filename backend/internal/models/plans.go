package models

import "time"

// MembershipPlan represents a membership tier (free, basic, premium)
type MembershipPlan struct {
	ID          int64     `json:"id"`
	Slug        string    `json:"slug"`
	Name        string    `json:"name"`
	Description *string   `json:"description,omitempty"`
	Tier        int       `json:"tier"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// PlanVersionStatus represents the lifecycle state of a plan version
type PlanVersionStatus string

const (
	PlanVersionActive     PlanVersionStatus = "active"
	PlanVersionDeprecated PlanVersionStatus = "deprecated"
	PlanVersionArchived   PlanVersionStatus = "archived"
)

// PlanVersion represents a specific price version of a membership plan
type PlanVersion struct {
	ID                int64             `json:"id"`
	PlanID            int64             `json:"plan_id"`
	Version           int               `json:"version"`
	StripeProductID   *string           `json:"stripe_product_id,omitempty"`
	StripePriceID     *string           `json:"stripe_price_id,omitempty"`
	PriceCents        int               `json:"price_cents"`
	Currency          string            `json:"currency"`
	BillingInterval   string            `json:"billing_interval"`
	Status            PlanVersionStatus `json:"status"`
	DeprecatedAt      *time.Time        `json:"deprecated_at,omitempty"`
	GracePeriodDays   int               `json:"grace_period_days"`
	MigrationDeadline *time.Time        `json:"migration_deadline,omitempty"`
	ArchivedAt        *time.Time        `json:"archived_at,omitempty"`
	CreatedAt         time.Time         `json:"created_at"`
	UpdatedAt         time.Time         `json:"updated_at"`
}

// PlanWithCurrentVersion combines a plan with its active version for display
type PlanWithCurrentVersion struct {
	Plan    MembershipPlan `json:"plan"`
	Version PlanVersion    `json:"version"`
}

// StripeWebhookEvent represents a parsed Stripe webhook event
type StripeWebhookEvent struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Data    JSONB  `json:"data"`
	Created int64  `json:"created"`
}

// CheckoutRequest represents a request to create a Stripe checkout session
type CheckoutRequest struct {
	UserEmail   string `json:"user_email"`
	PlanSlug    string `json:"plan_slug"`
	SuccessURL  string `json:"success_url"`
	CancelURL   string `json:"cancel_url"`
}

// CheckoutResponse represents the response from creating a checkout session
type CheckoutResponse struct {
	SessionID  string `json:"session_id"`
	SessionURL string `json:"session_url"`
}
