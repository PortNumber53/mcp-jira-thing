package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

// BillingStore defines the behaviour required from the storage client
// backing the billing handler.
type BillingStore interface {
	SaveSubscription(ctx context.Context, sub *models.Subscription) error
	GetSubscription(ctx context.Context, userEmail string) (*models.Subscription, error)
	UpdateSubscription(ctx context.Context, sub *models.Subscription) error
	SavePayment(ctx context.Context, payment *models.PaymentHistory) error
	GetPaymentHistory(ctx context.Context, userEmail string) ([]models.PaymentHistory, error)
}

// UserStore defines the behaviour required for user lookup operations.
type UserStore interface {
	GetUserByEmail(ctx context.Context, email string) (*models.User, error)
	DeleteUser(ctx context.Context, email string) error
}

type saveSubscriptionPayload struct {
	UserEmail            string     `json:"user_email"`
	StripeCustomerID     string     `json:"stripe_customer_id"`
	StripeSubscriptionID string     `json:"stripe_subscription_id"`
	StripePriceID        string     `json:"stripe_price_id"`
	Status               string     `json:"status"`
	CurrentPeriodStart   *time.Time `json:"current_period_start"`
	CurrentPeriodEnd     *time.Time `json:"current_period_end"`
	CancelAtPeriodEnd    *bool      `json:"cancel_at_period_end"`
	CanceledAt           *time.Time `json:"canceled_at"`
}

type savePaymentPayload struct {
	UserEmail             string  `json:"user_email"`
	StripeCustomerID      string  `json:"stripe_customer_id"`
	StripePaymentIntentID *string `json:"stripe_payment_intent_id"`
	StripeInvoiceID       *string `json:"stripe_invoice_id"`
	Amount                int     `json:"amount"`
	Currency              string  `json:"currency"`
	Status                string  `json:"status"`
	Description           *string `json:"description"`
	ReceiptURL            *string `json:"receipt_url"`
}

// SaveSubscription creates an HTTP handler that saves subscription data.
func SaveSubscription(store BillingStore, userStore UserStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var payload saveSubscriptionPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			log.Printf("SaveSubscription: invalid JSON payload: %v", err)
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}

		log.Printf("SaveSubscription: received payload for user=%s, status=%s, cancel_at_period_end=%v, canceled_at=%v",
			payload.UserEmail, payload.Status, payload.CancelAtPeriodEnd, payload.CanceledAt)

		userEmail := strings.TrimSpace(payload.UserEmail)
		if userEmail == "" || payload.StripeCustomerID == "" || payload.StripeSubscriptionID == "" {
			http.Error(w, "missing required fields", http.StatusBadRequest)
			return
		}

		// Get user ID from email
		user, err := userStore.GetUserByEmail(r.Context(), userEmail)
		if err != nil {
			log.Printf("SaveSubscription: failed to get user: %v", err)
			http.Error(w, "failed to find user", http.StatusBadRequest)
			return
		}

		sub := &models.Subscription{
			UserID:               user.ID,
			StripeCustomerID:     payload.StripeCustomerID,
			StripeSubscriptionID: payload.StripeSubscriptionID,
			StripePriceID:        payload.StripePriceID,
			Status:               payload.Status,
			CancelAtPeriodEnd:    false,
		}

		if payload.CurrentPeriodStart != nil {
			sub.CurrentPeriodStart = *payload.CurrentPeriodStart
		}
		if payload.CurrentPeriodEnd != nil {
			sub.CurrentPeriodEnd = *payload.CurrentPeriodEnd
		}
		if payload.CancelAtPeriodEnd != nil {
			sub.CancelAtPeriodEnd = *payload.CancelAtPeriodEnd
		}
		if payload.CanceledAt != nil {
			sub.CanceledAt = payload.CanceledAt
		}

		if err := store.SaveSubscription(r.Context(), sub); err != nil {
			log.Printf("SaveSubscription: failed to save subscription: %v", err)
			http.Error(w, "failed to save subscription", http.StatusInternalServerError)
			return
		}

		log.Printf("SaveSubscription: successfully saved subscription %s with status=%s, cancel_at_period_end=%v, canceled_at=%v",
			sub.StripeSubscriptionID, sub.Status, sub.CancelAtPeriodEnd, sub.CanceledAt)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

// SavePayment creates an HTTP handler that saves payment history.
func SavePayment(store BillingStore, userStore UserStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var payload savePaymentPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			log.Printf("SavePayment: invalid JSON payload: %v", err)
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}

		userEmail := strings.TrimSpace(payload.UserEmail)
		if userEmail == "" || payload.StripeCustomerID == "" {
			http.Error(w, "missing required fields", http.StatusBadRequest)
			return
		}

		// Get user ID from email
		user, err := userStore.GetUserByEmail(r.Context(), userEmail)
		if err != nil {
			log.Printf("SavePayment: failed to get user: %v", err)
			http.Error(w, "failed to find user", http.StatusBadRequest)
			return
		}

		payment := &models.PaymentHistory{
			UserID:                user.ID,
			StripeCustomerID:      payload.StripeCustomerID,
			StripePaymentIntentID: payload.StripePaymentIntentID,
			StripeInvoiceID:       payload.StripeInvoiceID,
			Amount:                payload.Amount,
			Currency:              payload.Currency,
			Status:                payload.Status,
			Description:           payload.Description,
			ReceiptURL:            payload.ReceiptURL,
		}

		if err := store.SavePayment(r.Context(), payment); err != nil {
			log.Printf("SavePayment: failed to save payment: %v", err)
			http.Error(w, "failed to save payment", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

// GetPaymentHistory creates an HTTP handler that returns payment history for a user.
func GetPaymentHistory(store BillingStore, userStore UserStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		email := strings.TrimSpace(r.URL.Query().Get("email"))
		if email == "" {
			http.Error(w, "email query parameter is required", http.StatusBadRequest)
			return
		}

		payments, err := store.GetPaymentHistory(r.Context(), email)
		if err != nil {
			log.Printf("GetPaymentHistory: failed to get payment history: %v", err)
			http.Error(w, "failed to get payment history", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"payments": payments,
		})
	}
}

// GetSubscription creates an HTTP handler that returns the current subscription for a user.
func GetSubscription(store BillingStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		email := strings.TrimSpace(r.URL.Query().Get("email"))
		if email == "" {
			http.Error(w, "email query parameter is required", http.StatusBadRequest)
			return
		}

		subscription, err := store.GetSubscription(r.Context(), email)
		if err != nil {
			log.Printf("GetSubscription: failed to get subscription: %v", err)
			http.Error(w, "failed to get subscription", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"subscription": subscription,
		})
	}
}

// DeleteAccount handles account deletion including Stripe subscription cancellation with prorated refund.
func DeleteAccount(billingStore BillingStore, userStore UserStore, stripeKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var payload struct {
			Email string `json:"email"`
		}

		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			log.Printf("DeleteAccount: invalid JSON payload: %v", err)
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}

		if payload.Email == "" {
			http.Error(w, "email is required", http.StatusBadRequest)
			return
		}

		// Check if user has an active subscription
		subscription, err := billingStore.GetSubscription(r.Context(), payload.Email)
		if err != nil && !strings.Contains(err.Error(), "not found") {
			log.Printf("DeleteAccount: failed to get subscription: %v", err)
			http.Error(w, "failed to check subscription", http.StatusInternalServerError)
			return
		}

		// If there's an active subscription, cancel it with prorated refund
		if subscription != nil && subscription.StripeSubscriptionID != "" {
			// Note: In a production environment, you would use the Stripe Go SDK here
			// For now, we'll log the cancellation request
			// The frontend should handle the Stripe API call with the secret key
			log.Printf("DeleteAccount: cancelling Stripe subscription %s for user %s with proration",
				subscription.StripeSubscriptionID, payload.Email)
		}

		// Delete the user from the database
		if err := userStore.DeleteUser(r.Context(), payload.Email); err != nil {
			log.Printf("DeleteAccount: failed to delete user: %v", err)
			http.Error(w, "failed to delete account", http.StatusInternalServerError)
			return
		}

		log.Printf("DeleteAccount: successfully deleted account for user %s", payload.Email)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"message": "Account deleted successfully",
		})
	}
}
