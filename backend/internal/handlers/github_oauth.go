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

type githubUserInfo struct {
	Login     string `json:"login"`
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

type githubTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	Scope       string `json:"scope"`
}

func GitHubOAuthLogin(cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cfg.GitHubClientID == "" {
			http.Error(w, `{"error":"GitHub OAuth is not configured"}`, http.StatusInternalServerError)
			return
		}

		redirect := r.URL.Query().Get("redirect")
		if redirect == "" {
			redirect = "/dashboard"
		}
		if !strings.HasPrefix(redirect, "/") {
			redirect = "/dashboard"
		}
		linkAccount := r.URL.Query().Get("link") == "true"

		nonce, err := session.RandomHex(32)
		if err != nil {
			log.Printf("[github-oauth] failed to generate nonce: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		state := session.StatePayload{
			Nonce:       nonce,
			Redirect:    redirect,
			CreatedAt:   time.Now().UnixMilli(),
			LinkAccount: linkAccount,
		}
		stateCookie, err := session.Encode(cfg.CookieSecret, state)
		if err != nil {
			log.Printf("[github-oauth] failed to encode state: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		secure := strings.HasPrefix(cfg.BackendURL, "https")
		session.SetCookie(w, session.StateCookie, stateCookie, cfg.CookieDomain, int(session.StateTTL.Seconds()), secure)

		redirectURI := cfg.BackendURL + "/callback/github"
		authorizeURL := fmt.Sprintf(
			"https://github.com/login/oauth/authorize?client_id=%s&redirect_uri=%s&response_type=code&scope=%s&state=%s&allow_signup=false",
			url.QueryEscape(cfg.GitHubClientID),
			url.QueryEscape(redirectURI),
			url.QueryEscape("read:user user:email"),
			url.QueryEscape(nonce),
		)

		http.Redirect(w, r, authorizeURL, http.StatusFound)
	}
}

func GitHubOAuthCallback(cfg config.Config, store OAuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("code")
		stateParam := r.URL.Query().Get("state")

		if code == "" || stateParam == "" {
			log.Printf("[github-callback] missing code or state")
			redirectWithError(w, r, cfg.FrontendURL, "missing code or state")
			return
		}

		stateCookie, err := r.Cookie(session.StateCookie)
		if err != nil {
			log.Printf("[github-callback] missing state cookie: %v", err)
			redirectWithError(w, r, cfg.FrontendURL, "missing state cookie")
			return
		}

		var statePayload session.StatePayload
		if err := session.Decode(cfg.CookieSecret, stateCookie.Value, &statePayload); err != nil {
			log.Printf("[github-callback] invalid state cookie: %v", err)
			redirectWithError(w, r, cfg.FrontendURL, "invalid state")
			return
		}

		if statePayload.Nonce != stateParam {
			log.Printf("[github-callback] state mismatch")
			redirectWithError(w, r, cfg.FrontendURL, "state mismatch")
			return
		}

		if time.Since(time.UnixMilli(statePayload.CreatedAt)) > session.StateTTL {
			log.Printf("[github-callback] state expired")
			redirectWithError(w, r, cfg.FrontendURL, "state expired")
			return
		}

		redirectURI := cfg.BackendURL + "/callback/github"
		tokenResp, err := exchangeGitHubCode(cfg.GitHubClientID, cfg.GitHubClientSecret, code, redirectURI)
		if err != nil {
			log.Printf("[github-callback] token exchange failed: %v", err)
			redirectWithError(w, r, cfg.FrontendURL, "token exchange failed")
			return
		}

		userInfo, err := fetchGitHubUserInfo(tokenResp.AccessToken)
		if err != nil {
			log.Printf("[github-callback] userinfo fetch failed: %v", err)
			redirectWithError(w, r, cfg.FrontendURL, "failed to get user info")
			return
		}

		login := userInfo.Login
		namePtr := strPtr(userInfo.Name)
		avatarPtr := strPtr(userInfo.AvatarURL)
		var emailPtr *string
		if userInfo.Email != "" {
			email := strings.ToLower(userInfo.Email)
			emailPtr = &email
		}

		if err := store.UpsertGitHubUser(r.Context(), models.GitHubAuthUser{
			GitHubID:    userInfo.ID,
			Login:       userInfo.Login,
			Name:        namePtr,
			Email:       emailPtr,
			AvatarURL:   avatarPtr,
			AccessToken: tokenResp.AccessToken,
		}); err != nil {
			log.Printf("[github-callback] failed to persist user: %v", err)
		}

		redirectTarget := statePayload.Redirect
		if redirectTarget == "" {
			redirectTarget = "/dashboard"
		}

		secure := strings.HasPrefix(cfg.FrontendURL, "https")

		if statePayload.LinkAccount {
			if existingSession, err := session.ReadSession(r, cfg.CookieSecret); err == nil && existingSession.Email != nil {
				if emailPtr != nil && strings.ToLower(*existingSession.Email) != *emailPtr {
					errorURL := cfg.FrontendURL + redirectTarget + "?error=email_mismatch&existing_email=" +
						url.QueryEscape(*existingSession.Email) + "&new_email=" + url.QueryEscape(*emailPtr)
					session.ClearCookie(w, session.StateCookie, cfg.CookieDomain, secure)
					http.Redirect(w, r, errorURL, http.StatusSeeOther)
					return
				}
				session.ClearCookie(w, session.StateCookie, cfg.CookieDomain, secure)
				http.Redirect(w, r, cfg.FrontendURL+redirectTarget, http.StatusSeeOther)
				return
			}
		}

		sessionPayload := session.Payload{
			Login:     login,
			ID:        time.Now().UnixMilli(),
			Name:      namePtr,
			AvatarURL: avatarPtr,
			Email:     emailPtr,
			Provider:  "github",
			Exp:       time.Now().Add(session.SessionTTL).Unix(),
		}

		sessionToken, err := session.Encode(cfg.CookieSecret, sessionPayload)
		if err != nil {
			log.Printf("[github-callback] failed to encode session: %v", err)
			redirectWithError(w, r, cfg.FrontendURL, "session creation failed")
			return
		}

		session.SetCookie(w, session.SessionCookie, sessionToken, cfg.CookieDomain, int(session.SessionTTL.Seconds()), secure)
		session.ClearCookie(w, session.StateCookie, cfg.CookieDomain, secure)

		http.Redirect(w, r, cfg.FrontendURL+redirectTarget, http.StatusSeeOther)
	}
}

func exchangeGitHubCode(clientID, clientSecret, code, redirectURI string) (*githubTokenResponse, error) {
	data := url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
	}

	req, err := http.NewRequest("POST", "https://github.com/login/oauth/access_token", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "mcp-jira-thing-oauth")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("POST token: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, body)
	}

	var tokenResp githubTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("unmarshal token: %w", err)
	}
	return &tokenResp, nil
}

func fetchGitHubUserInfo(accessToken string) (*githubUserInfo, error) {
	req, _ := http.NewRequest("GET", "https://api.github.com/user", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "mcp-jira-thing-oauth")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET userinfo: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("userinfo returned %d: %s", resp.StatusCode, body)
	}

	var info githubUserInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, fmt.Errorf("unmarshal userinfo: %w", err)
	}
	return &info, nil
}
