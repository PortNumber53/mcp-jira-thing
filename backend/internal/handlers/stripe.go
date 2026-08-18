package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/config"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/session"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/store"
	stripeClient "github.com/PortNumber53/mcp-jira-thing/backend/internal/stripe"
	"github.com/go-chi/chi/v5"
)

// PlanStore defines the interface for plan storage operations
type PlanStore interface {
	ListPlans(ctx context.Context) ([]models.PlanWithCurrentVersion, error)
	GetPlanBySlug(ctx context.Context, slug string) (*models.MembershipPlan, error)
	GetActivePlanVersion(ctx context.Context, planID int64) (*models.PlanVersion, error)
	GetPlanVersionByStripePriceID(ctx context.Context, stripePriceID string) (*models.PlanVersion, error)
	UpdateSubscriptionPlanVersion(ctx context.Context, subscriptionID int64, newVersionID int64, newStripePriceID string) error
}

// SubscriptionLookupStore extends BillingStore with Stripe ID lookups
type SubscriptionLookupStore interface {
	GetSubscriptionByStripeID(ctx context.Context, stripeSubID string) (*models.Subscription, error)
	GetSubscriptionByCustomerID(ctx context.Context, customerID string) (*models.Subscription, error)
}

// StripeHandler holds dependencies for Stripe-related handlers
type StripeHandler struct {
	PlanStore     *store.PlanStore
	BillingStore  BillingStore
	SubLookup     SubscriptionLookupStore
	UserStore     UserStore
	Stripe        *stripeClient.Client
	WebhookSecret string
	cfg           config.Config
}

// NewStripeHandler creates a new StripeHandler
func NewStripeHandler(planStore *store.PlanStore, billingStore BillingStore, subLookup SubscriptionLookupStore, userStore UserStore, stripe *stripeClient.Client, webhookSecret string, cfg config.Config) *StripeHandler {
	return &StripeHandler{
		PlanStore:     planStore,
		BillingStore:  billingStore,
		SubLookup:     subLookup,
		UserStore:     userStore,
		Stripe:        stripe,
		WebhookSecret: webhookSecret,
		cfg:           cfg,
	}
}

// RegisterRoutes registers Stripe/billing routes
func (h *StripeHandler) RegisterRoutes(router chi.Router) {
	router.Get("/api/plans", h.ListPlans())
	router.Post("/api/checkout", h.CreateCheckout())
	router.Post("/api/webhooks/stripe", h.HandleWebhook())
	router.Post("/webhook/stripe", h.HandleWebhook())
	router.Get("/api/billing/current-plan", h.GetCurrentPlan())
	router.Post("/api/billing/create-subscription", h.CreateSubscription())
	router.Post("/api/billing/cancel-subscription", h.CancelSubscription())
}

// ListPlans returns all available membership plans with pricing
func (h *StripeHandler) ListPlans() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		plans, err := h.PlanStore.ListPlans(r.Context())
		if err != nil {
			log.Printf("ListPlans: failed: %v", err)
			http.Error(w, "failed to list plans", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"plans": plans,
		})
	}
}

// CreateCheckout creates a Stripe Checkout session
func (h *StripeHandler) CreateCheckout() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req models.CheckoutRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}

		if req.UserEmail == "" || req.PlanSlug == "" {
			http.Error(w, "user_email and plan_slug are required", http.StatusBadRequest)
			return
		}

		// Look up the plan and its active version
		plan, err := h.PlanStore.GetPlanBySlug(r.Context(), req.PlanSlug)
		if err != nil {
			log.Printf("CreateCheckout: plan not found: %v", err)
			http.Error(w, "plan not found", http.StatusNotFound)
			return
		}

		if plan.Tier == 0 {
			http.Error(w, "free plan does not require checkout", http.StatusBadRequest)
			return
		}

		version, err := h.PlanStore.GetActivePlanVersion(r.Context(), plan.ID)
		if err != nil || version.StripePriceID == nil {
			log.Printf("CreateCheckout: no active price for plan %s: %v", req.PlanSlug, err)
			http.Error(w, "plan not configured for billing", http.StatusInternalServerError)
			return
		}

		sessionID, sessionURL, err := h.Stripe.CreateCheckoutSession(
			req.UserEmail,
			*version.StripePriceID,
			req.SuccessURL,
			req.CancelURL,
		)
		if err != nil {
			log.Printf("CreateCheckout: Stripe error: %v", err)
			http.Error(w, "failed to create checkout session", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(models.CheckoutResponse{
			SessionID:  sessionID,
			SessionURL: sessionURL,
		})
	}
}

// GetCurrentPlan returns the user's current membership plan
func (h *StripeHandler) GetCurrentPlan() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		email := strings.TrimSpace(r.URL.Query().Get("email"))
		if email == "" {
			http.Error(w, "email query parameter is required", http.StatusBadRequest)
			return
		}

		sub, err := h.BillingStore.GetSubscription(r.Context(), email)
		if err != nil {
			log.Printf("GetCurrentPlan: error: %v", err)
			http.Error(w, "failed to get subscription", http.StatusInternalServerError)
			return
		}

		// Default to free plan
		result := map[string]interface{}{
			"plan_slug": "free",
			"plan_name": "Free",
			"tier":      0,
		}

		if sub != nil && sub.StripePriceID != "" {
			// Look up which plan version this price belongs to
			version, err := h.PlanStore.GetPlanVersionByStripePriceID(r.Context(), sub.StripePriceID)
			if err == nil {
				plan, planErr := h.PlanStore.GetPlanByID(r.Context(), version.PlanID)
				if planErr == nil {
					result["plan_slug"] = plan.Slug
					result["plan_name"] = plan.Name
					result["tier"] = plan.Tier
				}
				result["plan_version_id"] = version.ID
				result["price_cents"] = version.PriceCents
				result["billing_interval"] = version.BillingInterval
				result["subscription_status"] = sub.Status
				result["current_period_end"] = sub.CurrentPeriodEnd
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

// HandleWebhook processes Stripe webhook events
func (h *StripeHandler) HandleWebhook() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 65536))
		if err != nil {
			http.Error(w, "failed to read body", http.StatusBadRequest)
			return
		}

		event, err := stripeClient.ConstructWebhookEvent(body)
		if err != nil {
			log.Printf("Webhook: failed to parse event: %v", err)
			http.Error(w, "invalid webhook payload", http.StatusBadRequest)
			return
		}

		eventType, _ := event["type"].(string)
		eventID, _ := event["id"].(string)

		log.Printf("[webhook] Received event %s (type: %s)", eventID, eventType)

		switch eventType {
		case "checkout.session.completed":
			h.handleCheckoutCompleted(r.Context(), event)

		case "customer.subscription.created",
			"customer.subscription.updated":
			h.handleSubscriptionUpdated(r.Context(), event)

		case "customer.subscription.deleted":
			h.handleSubscriptionDeleted(r.Context(), event)

		case "invoice.payment_succeeded":
			h.handlePaymentSucceeded(r.Context(), event)

		case "invoice.payment_failed":
			h.handlePaymentFailed(r.Context(), event)

		default:
			log.Printf("[webhook] Unhandled event type: %s", eventType)
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}

func (h *StripeHandler) handleCheckoutCompleted(ctx context.Context, event map[string]interface{}) {
	data, _ := event["data"].(map[string]interface{})
	obj, _ := data["object"].(map[string]interface{})

	customerEmail, _ := obj["customer_email"].(string)
	subscriptionID, _ := obj["subscription"].(string)
	customerID, _ := obj["customer"].(string)

	if customerEmail == "" || subscriptionID == "" {
		log.Printf("[webhook] checkout.session.completed: missing email or subscription ID")
		return
	}

	log.Printf("[webhook] Checkout completed for %s, subscription: %s", customerEmail, subscriptionID)

	user, err := h.UserStore.GetUserByEmail(ctx, customerEmail)
	if err != nil {
		log.Printf("[webhook] checkout: user not found for %s: %v", customerEmail, err)
		return
	}

	sub := &models.Subscription{
		UserID:               user.ID,
		StripeCustomerID:     customerID,
		StripeSubscriptionID: subscriptionID,
		Status:               "active",
	}

	if err := h.BillingStore.SaveSubscription(ctx, sub); err != nil {
		log.Printf("[webhook] checkout: failed to save subscription: %v", err)
	}
}

func (h *StripeHandler) handleSubscriptionUpdated(ctx context.Context, event map[string]interface{}) {
	data, _ := event["data"].(map[string]interface{})
	obj, _ := data["object"].(map[string]interface{})

	subscriptionID, _ := obj["id"].(string)
	status, _ := obj["status"].(string)
	customerID, _ := obj["customer"].(string)
	cancelAtPeriodEnd, _ := obj["cancel_at_period_end"].(bool)

	// Extract price ID from items
	priceID := extractPriceID(obj)

	log.Printf("[webhook] Subscription %s updated: status=%s, price=%s, cancel_at_period_end=%v",
		subscriptionID, status, priceID, cancelAtPeriodEnd)

	// Find user by looking up existing subscription or customer
	sub, _ := h.findSubscriptionByStripeID(ctx, subscriptionID)
	if sub == nil {
		log.Printf("[webhook] subscription.updated: no local subscription found for %s", subscriptionID)
		return
	}

	sub.Status = status
	sub.StripePriceID = priceID
	sub.StripeCustomerID = customerID
	sub.CancelAtPeriodEnd = cancelAtPeriodEnd

	if err := h.BillingStore.UpdateSubscription(ctx, sub); err != nil {
		log.Printf("[webhook] subscription.updated: failed to update: %v", err)
	}

	// Update plan_version_id if price changed
	if priceID != "" {
		version, err := h.PlanStore.GetPlanVersionByStripePriceID(ctx, priceID)
		if err == nil {
			h.PlanStore.UpdateSubscriptionPlanVersion(ctx, sub.ID, version.ID, priceID)
		}
	}
}

func (h *StripeHandler) handleSubscriptionDeleted(ctx context.Context, event map[string]interface{}) {
	data, _ := event["data"].(map[string]interface{})
	obj, _ := data["object"].(map[string]interface{})

	subscriptionID, _ := obj["id"].(string)

	log.Printf("[webhook] Subscription %s deleted/canceled", subscriptionID)

	sub, _ := h.findSubscriptionByStripeID(ctx, subscriptionID)
	if sub == nil {
		return
	}

	sub.Status = "canceled"
	if err := h.BillingStore.UpdateSubscription(ctx, sub); err != nil {
		log.Printf("[webhook] subscription.deleted: failed to update: %v", err)
	}
}

func (h *StripeHandler) handlePaymentSucceeded(ctx context.Context, event map[string]interface{}) {
	data, _ := event["data"].(map[string]interface{})
	obj, _ := data["object"].(map[string]interface{})

	customerID, _ := obj["customer"].(string)
	amountPaid, _ := obj["amount_paid"].(float64)
	currency, _ := obj["currency"].(string)
	invoiceID, _ := obj["id"].(string)
	receiptURL, _ := obj["hosted_invoice_url"].(string)

	log.Printf("[webhook] Payment succeeded: customer=%s, amount=%d %s", customerID, int(amountPaid), currency)

	// Find user by customer ID - best effort
	payment := &models.PaymentHistory{
		StripeCustomerID: customerID,
		StripeInvoiceID:  &invoiceID,
		Amount:           int(amountPaid),
		Currency:         strings.ToLower(currency),
		Status:           "succeeded",
		ReceiptURL:       &receiptURL,
	}

	// Try to find user ID from subscription
	sub, _ := h.findSubscriptionByCustomerID(ctx, customerID)
	if sub != nil {
		payment.UserID = sub.UserID
		subID := sub.ID
		payment.SubscriptionID = &subID
	}

	if payment.UserID > 0 {
		if err := h.BillingStore.SavePayment(ctx, payment); err != nil {
			log.Printf("[webhook] payment.succeeded: failed to save: %v", err)
		}
	}
}

func (h *StripeHandler) handlePaymentFailed(ctx context.Context, event map[string]interface{}) {
	data, _ := event["data"].(map[string]interface{})
	obj, _ := data["object"].(map[string]interface{})

	customerID, _ := obj["customer"].(string)
	amountDue, _ := obj["amount_due"].(float64)
	currency, _ := obj["currency"].(string)
	invoiceID, _ := obj["id"].(string)

	log.Printf("[webhook] Payment failed: customer=%s, amount=%d %s", customerID, int(amountDue), currency)

	sub, _ := h.findSubscriptionByCustomerID(ctx, customerID)
	if sub != nil {
		payment := &models.PaymentHistory{
			UserID:           sub.UserID,
			StripeCustomerID: customerID,
			StripeInvoiceID:  &invoiceID,
			Amount:           int(amountDue),
			Currency:         strings.ToLower(currency),
			Status:           "failed",
		}
		subID := sub.ID
		payment.SubscriptionID = &subID

		if err := h.BillingStore.SavePayment(ctx, payment); err != nil {
			log.Printf("[webhook] payment.failed: failed to save: %v", err)
		}
	}
}

// Helper to find a subscription by Stripe subscription ID
func (h *StripeHandler) findSubscriptionByStripeID(ctx context.Context, stripeSubID string) (*models.Subscription, error) {
	return h.SubLookup.GetSubscriptionByStripeID(ctx, stripeSubID)
}

// Helper to find a subscription by Stripe customer ID
func (h *StripeHandler) findSubscriptionByCustomerID(ctx context.Context, customerID string) (*models.Subscription, error) {
	return h.SubLookup.GetSubscriptionByCustomerID(ctx, customerID)
}

// extractPriceID extracts the price ID from a subscription object's items
func extractPriceID(obj map[string]interface{}) string {
	items, ok := obj["items"].(map[string]interface{})
	if !ok {
		return ""
	}
	dataArr, ok := items["data"].([]interface{})
	if !ok || len(dataArr) == 0 {
		return ""
	}
	firstItem, ok := dataArr[0].(map[string]interface{})
	if !ok {
		return ""
	}
	price, ok := firstItem["price"].(map[string]interface{})
	if !ok {
		return ""
	}
	id, _ := price["id"].(string)
	return id
}

// CreateSubscription handles POST /api/billing/create-subscription.
// It reads the session cookie, creates a Stripe customer, attaches the provided
// payment method, sets it as the default, creates a subscription, and saves it
// to the database.
func (h *StripeHandler) CreateSubscription() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, err := session.ReadSession(r, h.cfg.CookieSecret)
		if err != nil {
			http.Error(w, "Not authenticated", http.StatusUnauthorized)
			return
		}

		if h.cfg.StripeSecretKey == "" {
			http.Error(w, "Stripe is not configured", http.StatusInternalServerError)
			return
		}

		if h.cfg.StripePriceID == "" {
			http.Error(w, "Stripe price ID is not configured", http.StatusInternalServerError)
			return
		}

		var req struct {
			PaymentMethodID string `json:"paymentMethodId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}

		if req.PaymentMethodID == "" {
			http.Error(w, "Payment method ID is required", http.StatusBadRequest)
			return
		}

		email := ""
		if sess.Email != nil {
			email = *sess.Email
		}
		name := ""
		if sess.Name != nil && *sess.Name != "" {
			name = *sess.Name
		}
		if name == "" {
			name = sess.Login
		}

		metadata := map[string]string{
			"user_id":      fmt.Sprintf("%d", sess.ID),
			"github_login": sess.Login,
		}

		customerID, err := h.Stripe.CreateCustomer(email, name, metadata)
		if err != nil {
			log.Printf("CreateSubscription: failed to create customer: %v", err)
			http.Error(w, "Failed to create customer", http.StatusInternalServerError)
			return
		}

		if err := h.Stripe.AttachPaymentMethod(req.PaymentMethodID, customerID); err != nil {
			log.Printf("CreateSubscription: failed to attach payment method: %v", err)
			http.Error(w, "Failed to attach payment method", http.StatusInternalServerError)
			return
		}

		if err := h.Stripe.SetDefaultPaymentMethod(customerID, req.PaymentMethodID); err != nil {
			log.Printf("CreateSubscription: failed to set default payment method: %v", err)
			http.Error(w, "Failed to set default payment method", http.StatusInternalServerError)
			return
		}

		subObj, err := h.Stripe.CreateSubscription(customerID, h.cfg.StripePriceID)
		if err != nil {
			log.Printf("CreateSubscription: failed to create subscription: %v", err)
			http.Error(w, "Failed to create subscription", http.StatusInternalServerError)
			return
		}

		subID, _ := subObj["id"].(string)
		status, _ := subObj["status"].(string)
		priceID := extractPriceID(subObj)

		var periodStart, periodEnd time.Time
		if v, ok := subObj["current_period_start"].(float64); ok {
			periodStart = time.Unix(int64(v), 0)
		}
		if v, ok := subObj["current_period_end"].(float64); ok {
			periodEnd = time.Unix(int64(v), 0)
		}

		if email != "" {
			user, err := h.UserStore.GetUserByEmail(r.Context(), email)
			if err != nil {
				log.Printf("CreateSubscription: failed to get user: %v", err)
			} else {
				sub := &models.Subscription{
					UserID:               user.ID,
					StripeCustomerID:     customerID,
					StripeSubscriptionID: subID,
					StripePriceID:        priceID,
					Status:               status,
					CurrentPeriodStart:   periodStart,
					CurrentPeriodEnd:     periodEnd,
				}
				if err := h.BillingStore.SaveSubscription(r.Context(), sub); err != nil {
					log.Printf("CreateSubscription: failed to save subscription: %v", err)
				}
			}
		}

		var clientSecret string
		if latestInvoice, ok := subObj["latest_invoice"].(map[string]interface{}); ok {
			if pi, ok := latestInvoice["payment_intent"].(map[string]interface{}); ok {
				clientSecret, _ = pi["client_secret"].(string)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"subscriptionId": subID,
			"clientSecret":   clientSecret,
		})
	}
}

// CancelSubscription handles POST /api/billing/cancel-subscription.
// It reads the session cookie, retrieves the subscription from Stripe, and
// cancels it at period end (or syncs the existing cancellation state), then
// updates the database.
func (h *StripeHandler) CancelSubscription() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := session.ReadSession(r, h.cfg.CookieSecret); err != nil {
			http.Error(w, "Not authenticated", http.StatusUnauthorized)
			return
		}

		if h.cfg.StripeSecretKey == "" {
			http.Error(w, "Stripe is not configured", http.StatusInternalServerError)
			return
		}

		var req struct {
			SubscriptionID string `json:"subscriptionId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}

		if req.SubscriptionID == "" {
			http.Error(w, "Subscription ID is required", http.StatusBadRequest)
			return
		}

		existing, err := h.Stripe.GetSubscription(req.SubscriptionID)
		if err != nil {
			log.Printf("CancelSubscription: failed to retrieve subscription: %v", err)
			http.Error(w, "Failed to retrieve subscription", http.StatusInternalServerError)
			return
		}

		status, _ := existing["status"].(string)
		cancelAtPeriodEnd, _ := existing["cancel_at_period_end"].(bool)
		priceID := extractPriceID(existing)
		customerID, _ := existing["customer"].(string)
		subID, _ := existing["id"].(string)

		var periodStart, periodEnd time.Time
		if v, ok := existing["current_period_start"].(float64); ok {
			periodStart = time.Unix(int64(v), 0)
		}
		if v, ok := existing["current_period_end"].(float64); ok {
			periodEnd = time.Unix(int64(v), 0)
		}

		var canceledAt *time.Time
		if v, ok := existing["canceled_at"].(float64); ok && v > 0 {
			t := time.Unix(int64(v), 0)
			canceledAt = &t
		}

		alreadyCanceled := status == "canceled"
		if !alreadyCanceled && !cancelAtPeriodEnd {
			if err := h.Stripe.CancelAtPeriodEnd(subID); err != nil {
				log.Printf("CancelSubscription: failed to cancel subscription: %v", err)
				http.Error(w, "Failed to cancel subscription", http.StatusInternalServerError)
				return
			}
			cancelAtPeriodEnd = true
		}

		sub, _ := h.SubLookup.GetSubscriptionByStripeID(r.Context(), subID)
		if sub != nil {
			sub.Status = status
			sub.StripePriceID = priceID
			sub.StripeCustomerID = customerID
			sub.CancelAtPeriodEnd = cancelAtPeriodEnd
			sub.CurrentPeriodStart = periodStart
			sub.CurrentPeriodEnd = periodEnd
			sub.CanceledAt = canceledAt
			if alreadyCanceled {
				sub.Status = "canceled"
			}
			if err := h.BillingStore.UpdateSubscription(r.Context(), sub); err != nil {
				log.Printf("CancelSubscription: failed to update subscription: %v", err)
			}
		}

		message := "Subscription will be canceled at the end of the billing period"
		if alreadyCanceled {
			message = "Subscription is already canceled"
		} else if cancelAtPeriodEnd && !alreadyCanceled {
			message = "Subscription is already set to cancel at the end of the billing period"
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"subscription": existing,
			"message":      message,
		})
	}
}
