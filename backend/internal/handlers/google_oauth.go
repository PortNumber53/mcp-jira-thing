package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/config"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/session"
)

// googleUserInfo is the response from Google's userinfo endpoint.
type googleUserInfo struct {
	Sub     string `json:"sub"`
	Name    string `json:"name"`
	Email   string `json:"email"`
	Picture string `json:"picture"`
}

// googleTokenResponse is the response from Google's token endpoint.
type googleTokenResponse struct {
	AccessToken  string `json:"access_token"`
	IDToken      string `json:"id_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// GoogleOAuthLogin initiates the Google OAuth flow by redirecting to Google's
// authorization endpoint.
func GoogleOAuthLogin(cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cfg.GoogleClientID == "" {
			http.Error(w, `{"error":"Google OAuth is not configured"}`, http.StatusInternalServerError)
			return
		}

		redirect := r.URL.Query().Get("redirect")
		if redirect == "" {
			redirect = "/dashboard"
		}
		if !strings.HasPrefix(redirect, "/") {
			redirect = "/dashboard"
		}

		nonce, err := session.RandomHex(32)
		if err != nil {
			log.Printf("[google-oauth] failed to generate nonce: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		state := session.StatePayload{
			Nonce:     nonce,
			Redirect:  redirect,
			CreatedAt: time.Now().UnixMilli(),
		}
		stateCookie, err := session.Encode(cfg.CookieSecret, state)
		if err != nil {
			log.Printf("[google-oauth] failed to encode state: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		secure := strings.HasPrefix(cfg.BackendURL, "https")
		session.SetCookie(w, session.StateCookie, stateCookie, cfg.CookieDomain, int(session.StateTTL.Seconds()), secure)

		redirectURI := cfg.BackendURL + "/callback/google"

		authorizeURL := fmt.Sprintf(
			"https://accounts.google.com/o/oauth2/v2/auth?client_id=%s&redirect_uri=%s&response_type=code&scope=%s&state=%s&prompt=select_account",
			url.QueryEscape(cfg.GoogleClientID),
			url.QueryEscape(redirectURI),
			url.QueryEscape("openid email profile"),
			url.QueryEscape(nonce),
		)

		http.Redirect(w, r, authorizeURL, http.StatusFound)
	}
}

// GoogleOAuthCallback handles the OAuth callback from Google, exchanges the
// authorization code for tokens, fetches user info, persists the user, creates
// a session cookie, and redirects to the frontend.
func GoogleOAuthCallback(cfg config.Config, store OAuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("code")
		stateParam := r.URL.Query().Get("state")

		if code == "" || stateParam == "" {
			log.Printf("[google-callback] missing code or state")
			redirectWithError(w, r, cfg.FrontendURL, "missing code or state")
			return
		}

		// Validate state cookie
		stateCookie, err := r.Cookie(session.StateCookie)
		if err != nil {
			log.Printf("[google-callback] missing state cookie: %v", err)
			redirectWithError(w, r, cfg.FrontendURL, "missing state cookie")
			return
		}

		var statePayload session.StatePayload
		if err := session.Decode(cfg.CookieSecret, stateCookie.Value, &statePayload); err != nil {
			log.Printf("[google-callback] invalid state cookie: %v", err)
			redirectWithError(w, r, cfg.FrontendURL, "invalid state")
			return
		}

		if statePayload.Nonce != stateParam {
			log.Printf("[google-callback] state mismatch: cookie=%q param=%q", statePayload.Nonce, stateParam)
			redirectWithError(w, r, cfg.FrontendURL, "state mismatch")
			return
		}

		if time.Since(time.UnixMilli(statePayload.CreatedAt)) > session.StateTTL {
			log.Printf("[google-callback] state expired")
			redirectWithError(w, r, cfg.FrontendURL, "state expired")
			return
		}

		// Exchange code for tokens
		redirectURI := cfg.BackendURL + "/callback/google"
		tokenResp, err := exchangeGoogleCode(cfg.GoogleClientID, cfg.GoogleClientSecret, code, redirectURI)
		if err != nil {
			log.Printf("[google-callback] token exchange failed: %v", err)
			redirectWithError(w, r, cfg.FrontendURL, "token exchange failed")
			return
		}

		// Fetch user info
		userInfo, err := fetchGoogleUserInfo(tokenResp.AccessToken)
		if err != nil {
			log.Printf("[google-callback] userinfo fetch failed: %v", err)
			redirectWithError(w, r, cfg.FrontendURL, "failed to get user info")
			return
		}

		// Persist user in database
		email := strings.ToLower(userInfo.Email)
		namePtr := strPtr(userInfo.Name)
		emailPtr := &email
		avatarPtr := strPtr(userInfo.Picture)

		if err := store.UpsertGoogleUser(r.Context(), models.GoogleAuthUser{
			Sub:         userInfo.Sub,
			Name:        namePtr,
			Email:       emailPtr,
			AvatarURL:   avatarPtr,
			AccessToken: tokenResp.AccessToken,
		}); err != nil {
			log.Printf("[google-callback] failed to persist user: %v", err)
			// Non-fatal: continue with session creation
		}

		// Create session cookie
		sessionPayload := session.Payload{
			Login:     email,
			ID:        time.Now().UnixMilli(),
			Name:      namePtr,
			AvatarURL: avatarPtr,
			Email:     emailPtr,
			Provider:  "google",
			Exp:       time.Now().Add(session.SessionTTL).Unix(),
		}

		sessionToken, err := session.Encode(cfg.CookieSecret, sessionPayload)
		if err != nil {
			log.Printf("[google-callback] failed to encode session: %v", err)
			redirectWithError(w, r, cfg.FrontendURL, "session creation failed")
			return
		}

		secure := strings.HasPrefix(cfg.FrontendURL, "https")
		session.SetCookie(w, session.SessionCookie, sessionToken, cfg.CookieDomain, int(session.SessionTTL.Seconds()), secure)
		session.ClearCookie(w, session.StateCookie, cfg.CookieDomain, secure)

		redirectTarget := statePayload.Redirect
		if redirectTarget == "" {
			redirectTarget = "/dashboard"
		}

		http.Redirect(w, r, cfg.FrontendURL+redirectTarget, http.StatusSeeOther)
	}
}

// SessionCheck returns the current session state as JSON.
func SessionCheck(cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, err := session.ReadSession(r, cfg.CookieSecret)
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			json.NewEncoder(w).Encode(map[string]any{"authenticated": false})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"authenticated": true, "user": sess})
	}
}

// SessionLogout clears the session cookie.
func SessionLogout(cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		secure := strings.HasPrefix(cfg.FrontendURL, "https")
		session.ClearCookie(w, session.SessionCookie, cfg.CookieDomain, secure)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

// --- helpers ---

func exchangeGoogleCode(clientID, clientSecret, code, redirectURI string) (*googleTokenResponse, error) {
	data := url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"grant_type":    {"authorization_code"},
	}

	resp, err := http.PostForm("https://oauth2.googleapis.com/token", data)
	if err != nil {
		return nil, fmt.Errorf("POST token: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, body)
	}

	var tokenResp googleTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("unmarshal token: %w", err)
	}
	return &tokenResp, nil
}

func fetchGoogleUserInfo(accessToken string) (*googleUserInfo, error) {
	req, _ := http.NewRequest("GET", "https://openidconnect.googleapis.com/v1/userinfo", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET userinfo: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("userinfo returned %d: %s", resp.StatusCode, body)
	}

	var info googleUserInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, fmt.Errorf("unmarshal userinfo: %w", err)
	}
	return &info, nil
}

func redirectWithError(w http.ResponseWriter, r *http.Request, frontendURL, msg string) {
	target := frontendURL + "/login?error=" + url.QueryEscape(msg)
	http.Redirect(w, r, target, http.StatusSeeOther)
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
