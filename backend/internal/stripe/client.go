package stripe

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
)

// Client wraps Stripe API calls using the REST API directly (no SDK dependency)
type Client struct {
	secretKey  string
	httpClient *http.Client
	baseURL    string
}

// NewClient creates a new Stripe API client
func NewClient(secretKey string) *Client {
	return &Client{
		secretKey:  secretKey,
		httpClient: &http.Client{},
		baseURL:    "https://api.stripe.com/v1",
	}
}

// CreateCheckoutSession creates a Stripe Checkout session for a subscription
func (c *Client) CreateCheckoutSession(customerEmail, priceID, successURL, cancelURL string) (sessionID, sessionURL string, err error) {
	data := url.Values{}
	data.Set("mode", "subscription")
	data.Set("customer_email", customerEmail)
	data.Set("line_items[0][price]", priceID)
	data.Set("line_items[0][quantity]", "1")
	data.Set("success_url", successURL)
	data.Set("cancel_url", cancelURL)

	resp, err := c.post("/checkout/sessions", data)
	if err != nil {
		return "", "", fmt.Errorf("create checkout session: %w", err)
	}

	sessionID, _ = resp["id"].(string)
	sessionURL, _ = resp["url"].(string)
	if sessionID == "" {
		return "", "", fmt.Errorf("create checkout session: missing session ID in response")
	}

	return sessionID, sessionURL, nil
}

// UpdateSubscriptionPrice migrates a subscription to a new price (for plan version migration)
func (c *Client) UpdateSubscriptionPrice(subscriptionID, newPriceID string) error {
	// First, get the subscription to find the current item ID
	sub, err := c.get("/subscriptions/" + subscriptionID)
	if err != nil {
		return fmt.Errorf("get subscription for migration: %w", err)
	}

	// Extract the first subscription item ID
	items, ok := sub["items"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("unexpected subscription items format")
	}
	dataArr, ok := items["data"].([]interface{})
	if !ok || len(dataArr) == 0 {
		return fmt.Errorf("no subscription items found")
	}
	firstItem, ok := dataArr[0].(map[string]interface{})
	if !ok {
		return fmt.Errorf("unexpected subscription item format")
	}
	itemID, ok := firstItem["id"].(string)
	if !ok {
		return fmt.Errorf("missing subscription item ID")
	}

	// Update the subscription with the new price
	data := url.Values{}
	data.Set("items[0][id]", itemID)
	data.Set("items[0][price]", newPriceID)
	data.Set("proration_behavior", "create_prorations")

	_, err = c.post("/subscriptions/"+subscriptionID, data)
	if err != nil {
		return fmt.Errorf("update subscription price: %w", err)
	}

	log.Printf("[stripe] Migrated subscription %s to price %s", subscriptionID, newPriceID)
	return nil
}

// CancelSubscription cancels a Stripe subscription
func (c *Client) CancelSubscription(subscriptionID string, atPeriodEnd bool) error {
	if atPeriodEnd {
		data := url.Values{}
		data.Set("cancel_at_period_end", "true")
		_, err := c.post("/subscriptions/"+subscriptionID, data)
		return err
	}

	_, err := c.delete("/subscriptions/" + subscriptionID)
	return err
}

// ArchiveProduct archives a Stripe product (marks it inactive)
func (c *Client) ArchiveProduct(productID string) error {
	data := url.Values{}
	data.Set("active", "false")

	_, err := c.post("/products/"+productID, data)
	if err != nil {
		return fmt.Errorf("archive product: %w", err)
	}

	log.Printf("[stripe] Archived product %s", productID)
	return nil
}

// ArchivePrice archives a Stripe price (marks it inactive)
func (c *Client) ArchivePrice(priceID string) error {
	data := url.Values{}
	data.Set("active", "false")

	_, err := c.post("/prices/"+priceID, data)
	if err != nil {
		return fmt.Errorf("archive price: %w", err)
	}

	log.Printf("[stripe] Archived price %s", priceID)
	return nil
}

// CreateProduct creates a new Stripe product
func (c *Client) CreateProduct(name, description string) (string, error) {
	data := url.Values{}
	data.Set("name", name)
	if description != "" {
		data.Set("description", description)
	}

	resp, err := c.post("/products", data)
	if err != nil {
		return "", fmt.Errorf("create product: %w", err)
	}

	productID, _ := resp["id"].(string)
	return productID, nil
}

// CreatePrice creates a new Stripe price for a product
func (c *Client) CreatePrice(productID string, unitAmountCents int, currency, interval string) (string, error) {
	data := url.Values{}
	data.Set("product", productID)
	data.Set("unit_amount", fmt.Sprintf("%d", unitAmountCents))
	data.Set("currency", currency)
	data.Set("recurring[interval]", interval)

	resp, err := c.post("/prices", data)
	if err != nil {
		return "", fmt.Errorf("create price: %w", err)
	}

	priceID, _ := resp["id"].(string)
	return priceID, nil
}

// ConstructWebhookEvent parses and returns the raw event body
// In production, you should verify the webhook signature using the signing secret
func ConstructWebhookEvent(body []byte) (map[string]interface{}, error) {
	var event map[string]interface{}
	if err := json.Unmarshal(body, &event); err != nil {
		return nil, fmt.Errorf("parse webhook event: %w", err)
	}
	return event, nil
}

// HTTP helpers

func (c *Client) post(path string, data url.Values) (map[string]interface{}, error) {
	req, err := http.NewRequest("POST", c.baseURL+path, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.secretKey, "")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	return c.doRequest(req)
}

func (c *Client) get(path string) (map[string]interface{}, error) {
	req, err := http.NewRequest("GET", c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.secretKey, "")

	return c.doRequest(req)
}

func (c *Client) delete(path string) (map[string]interface{}, error) {
	req, err := http.NewRequest("DELETE", c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.secretKey, "")

	return c.doRequest(req)
}

func (c *Client) doRequest(req *http.Request) (map[string]interface{}, error) {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("stripe request failed: %w", err)
	}
	defer resp.Body.Close()

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, resp.Body); err != nil {
		return nil, fmt.Errorf("read stripe response: %w", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(buf.Bytes(), &result); err != nil {
		return nil, fmt.Errorf("parse stripe response: %w", err)
	}

	if resp.StatusCode >= 400 {
		errObj, _ := result["error"].(map[string]interface{})
		msg := "unknown error"
		if errObj != nil {
			if m, ok := errObj["message"].(string); ok {
				msg = m
			}
		}
		return nil, fmt.Errorf("stripe API error (%d): %s", resp.StatusCode, msg)
	}

	return result, nil
}
