package handlers

import (
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/config"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/session"
)

const googleDocsScopes = "https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.readonly"

// GoogleDocsConnect initiates the Google Docs OAuth flow by redirecting to
// Google's authorization endpoint.
func GoogleDocsConnect(cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := session.ReadSession(r, cfg.CookieSecret); err != nil {
			http.Error(w, `{"error":"Not authenticated"}`, http.StatusUnauthorized)
			return
		}

		if cfg.GoogleClientID == "" {
			http.Error(w, `{"error":"Google Docs integration is not configured"}`, http.StatusInternalServerError)
			return
		}

		nonce, err := session.RandomHex(32)
		if err != nil {
			log.Printf("[google-docs] failed to generate nonce: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		state := session.StatePayload{
			Nonce:     nonce,
			Redirect:  "/integrations",
			CreatedAt: time.Now().UnixMilli(),
		}
		stateCookie, err := session.Encode(cfg.CookieSecret, state)
		if err != nil {
			log.Printf("[google-docs] failed to encode state: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		secure := strings.HasPrefix(cfg.BackendURL, "https")
		session.SetCookie(w, session.GoogleDocsStateCookie, stateCookie, cfg.CookieDomain, int(session.StateTTL.Seconds()), secure)

		redirectURI := cfg.BackendURL + "/callback/google-docs"

		authorizeURL := fmt.Sprintf(
			"https://accounts.google.com/o/oauth2/v2/auth?client_id=%s&redirect_uri=%s&response_type=code&scope=%s&access_type=offline&prompt=consent&state=%s",
			url.QueryEscape(cfg.GoogleClientID),
			url.QueryEscape(redirectURI),
			url.QueryEscape(googleDocsScopes),
			url.QueryEscape(nonce),
		)

		http.Redirect(w, r, authorizeURL, http.StatusFound)
	}
}

// GoogleDocsCallback handles the OAuth callback from Google, exchanges the
// authorization code for tokens, and persists the integration tokens.
func GoogleDocsCallback(cfg config.Config, store IntegrationTokenStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, err := session.ReadSession(r, cfg.CookieSecret)
		if err != nil {
			http.Error(w, "Not authenticated", http.StatusUnauthorized)
			return
		}

		code := r.URL.Query().Get("code")
		stateParam := r.URL.Query().Get("state")
		oauthError := r.URL.Query().Get("error")

		secure := strings.HasPrefix(cfg.FrontendURL, "https")

		if oauthError != "" {
			session.ClearCookie(w, session.GoogleDocsStateCookie, cfg.CookieDomain, secure)
			http.Redirect(w, r, cfg.FrontendURL+"/integrations?error="+url.QueryEscape(oauthError), http.StatusSeeOther)
			return
		}

		if code == "" || stateParam == "" {
			http.Error(w, "Missing code or state", http.StatusBadRequest)
			return
		}

		stateCookie, err := r.Cookie(session.GoogleDocsStateCookie)
		if err != nil {
			log.Printf("[google-docs-callback] missing state cookie: %v", err)
			http.Error(w, "OAuth state cookie is missing", http.StatusBadRequest)
			return
		}

		var statePayload session.StatePayload
		if err := session.Decode(cfg.CookieSecret, stateCookie.Value, &statePayload); err != nil {
			log.Printf("[google-docs-callback] invalid state cookie: %v", err)
			http.Error(w, "Invalid state parameter", http.StatusBadRequest)
			return
		}

		if statePayload.Nonce != stateParam {
			log.Printf("[google-docs-callback] state mismatch: cookie=%q param=%q", statePayload.Nonce, stateParam)
			http.Error(w, "Invalid state parameter", http.StatusBadRequest)
			return
		}

		if time.Since(time.UnixMilli(statePayload.CreatedAt)) > session.StateTTL {
			log.Printf("[google-docs-callback] state expired")
			http.Error(w, "state expired", http.StatusBadRequest)
			return
		}

		redirectURI := cfg.BackendURL + "/callback/google-docs"
		tokenResp, err := exchangeGoogleCode(cfg.GoogleClientID, cfg.GoogleClientSecret, code, redirectURI)
		if err != nil {
			log.Printf("[google-docs-callback] token exchange failed: %v", err)
			session.ClearCookie(w, session.GoogleDocsStateCookie, cfg.CookieDomain, secure)
			http.Redirect(w, r, cfg.FrontendURL+"/integrations?error=token_exchange_failed", http.StatusSeeOther)
			return
		}

		if sess.Email == nil {
			log.Printf("[google-docs-callback] session has no email")
			session.ClearCookie(w, session.GoogleDocsStateCookie, cfg.CookieDomain, secure)
			http.Redirect(w, r, cfg.FrontendURL+"/integrations?error=no_session_email", http.StatusSeeOther)
			return
		}

		var refreshToken *string
		if tokenResp.RefreshToken != "" {
			refreshToken = &tokenResp.RefreshToken
		}

		tokenType := tokenResp.TokenType
		if tokenType == "" {
			tokenType = "Bearer"
		}

		var expiresAt *string
		if tokenResp.ExpiresIn > 0 {
			t := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second).UTC().Format(time.RFC3339)
			expiresAt = &t
		}

		var scopes *string
		if tokenResp.Scope != "" {
			scopes = &tokenResp.Scope
		}

		if err := store.UpsertIntegrationToken(
			r.Context(),
			*sess.Email,
			"google_docs",
			tokenResp.AccessToken,
			refreshToken,
			tokenType,
			expiresAt,
			scopes,
			nil,
		); err != nil {
			log.Printf("[google-docs-callback] failed to store token: %v", err)
			session.ClearCookie(w, session.GoogleDocsStateCookie, cfg.CookieDomain, secure)
			http.Redirect(w, r, cfg.FrontendURL+"/integrations?error=token_store_failed", http.StatusSeeOther)
			return
		}

		session.ClearCookie(w, session.GoogleDocsStateCookie, cfg.CookieDomain, secure)
		http.Redirect(w, r, cfg.FrontendURL+"/integrations?connected=google_docs", http.StatusSeeOther)
	}
}
