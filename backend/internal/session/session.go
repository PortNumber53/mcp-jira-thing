package session

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	SessionCookie   = "mjt_session"
	StateCookie     = "mjt_oauth_state"
	SessionTTL      = 7 * 24 * time.Hour
	StateTTL        = 5 * time.Minute
)

// Payload is the data stored in the session cookie, matching the frontend format.
type Payload struct {
	Login     string  `json:"login"`
	ID        int64   `json:"id"`
	Name      *string `json:"name,omitempty"`
	AvatarURL *string `json:"avatarUrl,omitempty"`
	Email     *string `json:"email,omitempty"`
	Provider  string  `json:"provider,omitempty"`
	Exp       int64   `json:"exp"`
}

// StatePayload is the data stored in the OAuth state cookie.
type StatePayload struct {
	Nonce       string `json:"nonce"`
	Redirect    string `json:"redirect"`
	CreatedAt   int64  `json:"createdAt"`
	LinkAccount bool   `json:"linkAccount,omitempty"`
}

// --- Base64URL helpers (no padding, URL-safe) ---

func base64URLEncode(data []byte) string {
	return base64.RawURLEncoding.EncodeToString(data)
}

func base64URLDecode(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

// --- HMAC-SHA256 sign/verify (compatible with frontend encodeSignedPayload) ---

func sign(secret, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return base64URLEncode(mac.Sum(nil))
}

func verify(secret, payload, signature string) bool {
	expected := sign(secret, payload)
	return hmac.Equal([]byte(expected), []byte(signature))
}

// Encode signs data as a "payload.signature" token compatible with the frontend.
func Encode(secret string, data any) (string, error) {
	jsonBytes, err := json.Marshal(data)
	if err != nil {
		return "", fmt.Errorf("marshal: %w", err)
	}
	payload := base64URLEncode(jsonBytes)
	sig := sign(secret, payload)
	return payload + "." + sig, nil
}

// Decode verifies and decodes a signed token into dst.
func Decode(secret, token string, dst any) error {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid token format")
	}
	if !verify(secret, parts[0], parts[1]) {
		return fmt.Errorf("invalid signature")
	}
	jsonBytes, err := base64URLDecode(parts[0])
	if err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	return json.Unmarshal(jsonBytes, dst)
}

// RandomHex returns a cryptographically random hex string of n bytes.
func RandomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// ReadSession extracts and validates the session from the request cookies.
func ReadSession(r *http.Request, secret string) (*Payload, error) {
	c, err := r.Cookie(SessionCookie)
	if err != nil {
		return nil, err
	}
	var p Payload
	if err := Decode(secret, c.Value, &p); err != nil {
		return nil, err
	}
	if p.Exp > 0 && time.Unix(p.Exp, 0).Before(time.Now()) {
		return nil, fmt.Errorf("session expired")
	}
	return &p, nil
}

// SetCookie is a helper to write a signed cookie.
func SetCookie(w http.ResponseWriter, name, value, domain string, maxAge int, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		Domain:   domain,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// ClearCookie removes a cookie by setting MaxAge to -1.
func ClearCookie(w http.ResponseWriter, name, domain string, secure bool) {
	SetCookie(w, name, "", domain, -1, secure)
}
