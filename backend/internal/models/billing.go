package models

import "time"

type Subscription struct {
	ID                   int64     `json:"id"`
	UserID               int64     `json:"user_id"`
	StripeCustomerID     string    `json:"stripe_customer_id"`
	StripeSubscriptionID string    `json:"stripe_subscription_id"`
	StripePriceID        string    `json:"stripe_price_id"`
	Status               string    `json:"status"`
	CurrentPeriodStart   time.Time `json:"current_period_start"`
	CurrentPeriodEnd     time.Time `json:"current_period_end"`
	CancelAtPeriodEnd    bool      `json:"cancel_at_period_end"`
	CanceledAt           *time.Time `json:"canceled_at,omitempty"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

type PaymentHistory struct {
	ID                     int64     `json:"id"`
	UserID                 int64     `json:"user_id"`
	SubscriptionID         *int64    `json:"subscription_id,omitempty"`
	StripeCustomerID       string    `json:"stripe_customer_id"`
	StripePaymentIntentID  *string   `json:"stripe_payment_intent_id,omitempty"`
	StripeInvoiceID        *string   `json:"stripe_invoice_id,omitempty"`
	Amount                 int       `json:"amount"`
	Currency               string    `json:"currency"`
	Status                 string    `json:"status"`
	Description            *string   `json:"description,omitempty"`
	ReceiptURL             *string   `json:"receipt_url,omitempty"`
	CreatedAt              time.Time `json:"created_at"`
}
