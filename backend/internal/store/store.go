package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strconv"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

const (
	defaultPageSize    = 200
	nextAuthUsersTable = "public.nextauth_users"
)

// Store provides database-backed accessors for application data.
type Store struct {
	db *sql.DB
}

// New creates a Store using the provided sql.DB connection.
func New(db *sql.DB) (*Store, error) {
	if db == nil {
		return nil, errors.New("db cannot be nil")
	}
	return &Store{db: db}, nil
}

// ListUsers returns up to `limit` users ordered by creation time descending.
func (s *Store) ListUsers(ctx context.Context, limit int) ([]models.PublicUser, error) {
	if limit <= 0 || limit > defaultPageSize {
		limit = defaultPageSize
	}

	query := fmt.Sprintf(`
SELECT
  COALESCE(xata_id, '') AS id,
  email,
  name,
  image
FROM %s
ORDER BY xata_createdat DESC
LIMIT $1
`, nextAuthUsersTable)

	rows, err := s.db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("query %s: %w", nextAuthUsersTable, err)
	}
	defer rows.Close()

	var users []models.PublicUser
	for rows.Next() {
		var (
			id    string
			email sql.NullString
			name  sql.NullString
			image sql.NullString
		)

		if err := rows.Scan(&id, &email, &name, &image); err != nil {
			return nil, fmt.Errorf("scan %s: %w", nextAuthUsersTable, err)
		}

		users = append(users, models.PublicUser{
			ID:    id,
			Email: nullStringPtr(email),
			Name:  nullStringPtr(name),
			Image: nullStringPtr(image),
		})
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate %s: %w", nextAuthUsersTable, err)
	}

	return users, nil
}

// UpsertGitHubUser ensures that the given GitHub-authenticated user exists in
// the local users and users_oauths tables. It merges identities by email so a
// single logical user can have multiple OAuth methods attached.
func (s *Store) UpsertGitHubUser(ctx context.Context, user models.GitHubAuthUser) error {
	if s == nil || s.db == nil {
		return errors.New("store: db cannot be nil")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin upsert github user tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	// Try to find an existing user by email (case-insensitive) so we can
	// merge multiple OAuth providers into a single logical user.
	var userID int64
	var existingEmail sql.NullString
	var existingAvatar sql.NullString
	var foundByEmail bool

	if user.Email != nil && *user.Email != "" {
		if err := tx.QueryRowContext(
			ctx,
			`SELECT id, email, avatar_url FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
			*user.Email,
		).Scan(&userID, &existingEmail, &existingAvatar); err == nil {
			foundByEmail = true
		} else if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("store: lookup user by email: %w", err)
		}
	}

	accountID := strconv.FormatInt(user.GitHubID, 10)

	if !foundByEmail {
		// Create or update a user row keyed by (provider, provider_account_id).
		if err := tx.QueryRowContext(
			ctx,
			`INSERT INTO users (login, name, email, avatar_url, provider, provider_account_id)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (provider, provider_account_id) DO UPDATE
			 SET login = EXCLUDED.login,
			     name = EXCLUDED.name,
			     email = EXCLUDED.email,
			     avatar_url = EXCLUDED.avatar_url,
			     updated_at = now()
			 RETURNING id`,
			user.Login,
			user.Name,
			user.Email,
			user.AvatarURL,
			"github",
			accountID,
		).Scan(&userID); err != nil {
			return fmt.Errorf("store: upsert users by provider/account: %w", err)
		}
	} else {
		// Merge into the existing user row found by email and set/refresh
		// GitHub-specific fields only when canonical identity is not set.
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE users
			 SET login = $1,
			     name = $2,
			     email = $3,
			     avatar_url = COALESCE(avatar_url, $4),
			     provider = CASE WHEN provider = '' THEN $5 ELSE provider END,
			     provider_account_id = CASE WHEN provider_account_id = '' THEN $6 ELSE provider_account_id END,
			     updated_at = now()
			 WHERE id = $7`,
			user.Login,
			user.Name,
			user.Email,
			user.AvatarURL,
			"github",
			accountID,
			userID,
		); err != nil {
			return fmt.Errorf("store: update existing user by email: %w", err)
		}
	}

	scope := ""
	if user.Scope != nil {
		scope = *user.Scope
	}

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO users_oauths (user_id, provider, provider_account_id, access_token, scope, avatar_url)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (provider, provider_account_id) DO UPDATE
		 SET access_token = EXCLUDED.access_token,
		     scope = EXCLUDED.scope,
		     avatar_url = EXCLUDED.avatar_url,
		     updated_at = now()`,
		userID,
		"github",
		accountID,
		user.AccessToken,
		scope,
		user.AvatarURL,
	); err != nil {
		return fmt.Errorf("store: upsert users_oauths: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: commit upsert github user tx: %w", err)
	}

	return nil
}

// UpsertGoogleUser ensures that the given Google-authenticated user exists in
// the local users and users_oauths tables. It merges identities by email so a
// single logical user can have multiple OAuth methods attached.
func (s *Store) UpsertGoogleUser(ctx context.Context, user models.GoogleAuthUser) error {
	if s == nil || s.db == nil {
		return errors.New("store: db cannot be nil")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin upsert google user tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var userID int64
	var existingEmail sql.NullString
	var existingAvatar sql.NullString
	var foundByEmail bool

	if user.Email != nil && *user.Email != "" {
		if err := tx.QueryRowContext(
			ctx,
			`SELECT id, email, avatar_url FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
			*user.Email,
		).Scan(&userID, &existingEmail, &existingAvatar); err == nil {
			foundByEmail = true
		} else if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("store: lookup user by email: %w", err)
		}
	}

	accountID := user.Sub
	login := accountID
	if user.Email != nil && *user.Email != "" {
		login = *user.Email
	}

	if !foundByEmail {
		// Create or update a user row keyed by (provider, provider_account_id).
		if err := tx.QueryRowContext(
			ctx,
			`INSERT INTO users (login, name, email, avatar_url, provider, provider_account_id)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (provider, provider_account_id) DO UPDATE
			 SET login = EXCLUDED.login,
			     name = EXCLUDED.name,
			     email = EXCLUDED.email,
			     avatar_url = EXCLUDED.avatar_url,
			     updated_at = now()
			 RETURNING id`,
			login,
			user.Name,
			user.Email,
			user.AvatarURL,
			"google",
			accountID,
		).Scan(&userID); err != nil {
			return fmt.Errorf("store: upsert users by provider/account (google): %w", err)
		}
	} else {
		// Merge into the existing user row found by email and set/refresh
		// Google-specific fields only when canonical identity is not set.
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE users
			 SET login = $1,
			     name = $2,
			     email = $3,
			     avatar_url = COALESCE(avatar_url, $4),
			     provider = CASE WHEN provider = '' THEN $5 ELSE provider END,
			     provider_account_id = CASE WHEN provider_account_id = '' THEN $6 ELSE provider_account_id END,
			     updated_at = now()
			 WHERE id = $7`,
			login,
			user.Name,
			user.Email,
			user.AvatarURL,
			"google",
			accountID,
			userID,
		); err != nil {
			return fmt.Errorf("store: update existing user by email (google): %w", err)
		}
	}

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO users_oauths (user_id, provider, provider_account_id, access_token, scope, avatar_url)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (provider, provider_account_id) DO UPDATE
		 SET access_token = EXCLUDED.access_token,
		     scope = EXCLUDED.scope,
		     avatar_url = EXCLUDED.avatar_url,
		     updated_at = now()`,
		userID,
		"google",
		accountID,
		user.AccessToken,
		"",
		user.AvatarURL,
	); err != nil {
		return fmt.Errorf("store: upsert users_oauths (google): %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: commit upsert google user tx: %w", err)
	}

	return nil
}

// UpsertUserSettings ensures that a Jira settings row exists for the given
// owning user email address and base URL. JiraEmail may differ from userEmail
// and is stored as-is in users_settings. It will create or update the record
// in the users_settings table identified by (user_id, jira_base_url).
func (s *Store) UpsertUserSettings(ctx context.Context, userEmail, baseURL, jiraEmail, apiKey string) error {
	if s == nil || s.db == nil {
		return errors.New("store: db cannot be nil")
	}

	var userID int64
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
		userEmail,
	).Scan(&userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("store: no local user found for email=%s", userEmail)
		}
		return fmt.Errorf("store: lookup user by email: %w", err)
	}

	if _, err := s.db.ExecContext(
		ctx,
		`INSERT INTO users_settings (user_id, jira_base_url, jira_email, jira_api_token)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, jira_base_url) DO UPDATE
		 SET jira_email = EXCLUDED.jira_email,
		     jira_api_token = EXCLUDED.jira_api_token,
		     updated_at = now()`,
		userID,
		baseURL,
		jiraEmail,
		apiKey,
	); err != nil {
		return fmt.Errorf("store: upsert users_settings: %w", err)
	}

	return nil
}

// ListUserSettings returns all Jira settings records associated with the given
// email address. Sensitive fields such as jira_api_token are intentionally
// omitted from the returned data.
func (s *Store) ListUserSettings(ctx context.Context, email string) ([]models.JiraUserSettings, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store: db cannot be nil")
	}

	rows, err := s.db.QueryContext(ctx, `
SELECT
  us.jira_base_url,
  us.jira_email,
  us.jira_cloud_id,
  us.is_default
FROM users_settings us
JOIN users u ON us.user_id = u.id
WHERE LOWER(u.email) = LOWER($1)
ORDER BY us.is_default DESC, us.jira_base_url ASC
`, email)
	if err != nil {
		return nil, fmt.Errorf("store: list users_settings by email: %w", err)
	}
	defer rows.Close()

	var settings []models.JiraUserSettings
	for rows.Next() {
		var (
			baseURL string
			jiraEmail string
			cloudID sql.NullString
			isDefault bool
		)

		if err := rows.Scan(&baseURL, &jiraEmail, &cloudID, &isDefault); err != nil {
			return nil, fmt.Errorf("store: scan users_settings: %w", err)
		}

		settings = append(settings, models.JiraUserSettings{
			JiraBaseURL: baseURL,
			JiraEmail:   jiraEmail,
			JiraCloudID: nullStringPtr(cloudID),
			IsDefault:   isDefault,
		})
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate users_settings: %w", err)
	}

	return settings, nil
}

// GetUserSettingsByMCPSecret looks up the most appropriate Jira settings row
// for the user identified by the given mcp_secret. It prefers the row marked
// as is_default, but will fall back to any available settings if none are
// marked as default.
func (s *Store) GetUserSettingsByMCPSecret(ctx context.Context, secret string) (*models.JiraUserSettingsWithSecret, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store: db cannot be nil")
	}

	row := s.db.QueryRowContext(ctx, `
SELECT
  us.jira_base_url,
  us.jira_email,
  us.jira_cloud_id,
  us.is_default,
  us.jira_api_token
FROM users_settings us
JOIN users u ON us.user_id = u.id
WHERE u.mcp_secret = $1
ORDER BY us.is_default DESC, us.jira_base_url ASC
LIMIT 1
`, secret)

	var (
		baseURL  string
		jiraEmail string
		cloudID  sql.NullString
		isDefault bool
		apiToken string
	)

	if err := row.Scan(&baseURL, &jiraEmail, &cloudID, &isDefault, &apiToken); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("store: no Jira settings found for provided mcp_secret")
		}
		return nil, fmt.Errorf("store: lookup users_settings by mcp_secret: %w", err)
	}

	return &models.JiraUserSettingsWithSecret{
		JiraBaseURL:       baseURL,
		JiraEmail:         jiraEmail,
		JiraCloudID:       nullStringPtr(cloudID),
		IsDefault:         isDefault,
		AtlassianAPIToken: apiToken,
	}, nil
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func randomHex(nBytes int) (string, error) {
	buf := make([]byte, nBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// GenerateMCPSecret creates and stores a new random mcp_secret for the user
// identified by email. The newly generated secret is returned.
func (s *Store) GenerateMCPSecret(ctx context.Context, email string) (string, error) {
	if s == nil || s.db == nil {
		return "", errors.New("store: db cannot be nil")
	}

	var userID int64
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
		email,
	).Scan(&userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("store: no local user found for email=%s", email)
		}
		return "", fmt.Errorf("store: lookup user by email for mcp_secret: %w", err)
	}

	secret, err := randomHex(32)
	if err != nil {
		return "", fmt.Errorf("store: generate mcp_secret: %w", err)
	}

	if _, err := s.db.ExecContext(
		ctx,
		`UPDATE users SET mcp_secret = $1, updated_at = now() WHERE id = $2`,
		secret,
		userID,
	); err != nil {
		return "", fmt.Errorf("store: update mcp_secret: %w", err)
	}

	return secret, nil
}

// GetMCPSecret returns the existing mcp_secret for the user identified by
// email, or nil if none has been set.
func (s *Store) GetMCPSecret(ctx context.Context, email string) (*string, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store: db cannot be nil")
	}

	var secret sql.NullString
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT mcp_secret FROM users WHERE LOWER(email) = LOWER($1)`,
		email,
	).Scan(&secret); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("store: no local user found for email=%s", email)
		}
		return nil, fmt.Errorf("store: lookup mcp_secret by email: %w", err)
	}

	if !secret.Valid {
		return nil, nil
	}

	return &secret.String, nil
}

// GetUserIDByMCPSecret retrieves the user ID for a given MCP secret
func (s *Store) GetUserIDByMCPSecret(ctx context.Context, secret string) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store: db cannot be nil")
	}

	var userID int64
	err := s.db.QueryRowContext(ctx, "SELECT id FROM users WHERE mcp_secret = $1", secret).Scan(&userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, fmt.Errorf("store: no user found for MCP secret")
		}
		return 0, fmt.Errorf("store: query user by MCP secret: %w", err)
	}

	return userID, nil
}

// CreateRequest records a new API request for usage tracking
func (s *Store) CreateRequest(ctx context.Context, userID int64, method, endpoint string, statusCode int, responseTimeMs, requestSizeBytes, responseSizeBytes *int, errorMessage *string) error {
	if s == nil || s.db == nil {
		return errors.New("store: db cannot be nil")
	}

	query := `
	INSERT INTO requests (user_id, method, endpoint, status_code, response_time_ms, request_size_bytes, response_size_bytes, error_message)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`

	var errMessage sql.NullString
	if errorMessage != nil {
		errMessage = sql.NullString{String: *errorMessage, Valid: true}
	}

	log.Printf("[store] Attempting to create request: method=%s, endpoint=%s, userID=%d", method, endpoint, userID)
	_, err := s.db.ExecContext(ctx, query, userID, method, endpoint, statusCode, responseTimeMs, requestSizeBytes, responseSizeBytes, errMessage)
	if err != nil {
		log.Printf("[store] Error creating request: %v", err)
		return fmt.Errorf("store: create request: %w", err)
	}
	log.Printf("[store] Successfully created request: method=%s, endpoint=%s", method, endpoint)

	return nil
}

// GetUserRequests returns requests for a specific user with pagination
func (s *Store) GetUserRequests(ctx context.Context, userID int64, limit, offset int) ([]models.Request, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store: db cannot be nil")
	}

	if limit <= 0 || limit > defaultPageSize {
		limit = defaultPageSize
	}

	query := `
	SELECT 
		id::text,
		user_id::text,
		method,
		endpoint,
		status_code,
		response_time_ms,
		request_size_bytes,
		response_size_bytes,
		error_message,
		created_at
	FROM requests 
	WHERE user_id = $1
	ORDER BY created_at DESC
	LIMIT $2 OFFSET $3
	`

	rows, err := s.db.QueryContext(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("store: get user requests: %w", err)
	}
	defer rows.Close()

	var requests []models.Request
	for rows.Next() {
		var req models.Request
		var errMessage sql.NullString

		err := rows.Scan(
			&req.ID,
			&req.UserID,
			&req.Method,
			&req.Endpoint,
			&req.StatusCode,
			&req.ResponseTimeMs,
			&req.RequestSizeBytes,
			&req.ResponseSizeBytes,
			&errMessage,
			&req.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("store: scan request: %w", err)
		}

		if errMessage.Valid {
			req.ErrorMessage = &errMessage.String
		}

		requests = append(requests, req)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate requests: %w", err)
	}

	return requests, nil
}

// GetUserMetrics returns aggregated usage metrics for a user
func (s *Store) GetUserMetrics(ctx context.Context, userID int64) (*models.RequestMetrics, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store: db cannot be nil")
	}

	query := `
	SELECT 
		user_id::text,
		COUNT(*) as total_requests,
		COUNT(CASE WHEN status_code < 400 THEN 1 END) as success_requests,
		COUNT(CASE WHEN status_code >= 400 THEN 1 END) as error_requests,
		COALESCE(AVG(response_time_ms), 0) as avg_response_time_ms,
		COALESCE(SUM(COALESCE(request_size_bytes, 0) + COALESCE(response_size_bytes, 0)), 0) as total_bytes,
		MAX(created_at) as last_request_at
	FROM requests 
	WHERE user_id = $1
	GROUP BY user_id
	`

	var metrics models.RequestMetrics
	err := s.db.QueryRowContext(ctx, query, userID).Scan(
		&metrics.UserID,
		&metrics.TotalRequests,
		&metrics.SuccessRequests,
		&metrics.ErrorRequests,
		&metrics.AvgResponseTimeMs,
		&metrics.TotalBytes,
		&metrics.LastRequestAt,
	)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// Return empty metrics for user with no requests
			metrics.UserID = fmt.Sprintf("%d", userID)
			metrics.TotalRequests = 0
			metrics.SuccessRequests = 0
			metrics.ErrorRequests = 0
			metrics.AvgResponseTimeMs = 0
			metrics.TotalBytes = 0
			return &metrics, nil
		}
		return nil, fmt.Errorf("store: get user metrics: %w", err)
	}

	return &metrics, nil
}

// GetAllMetrics returns aggregated usage metrics for all users
func (s *Store) GetAllMetrics(ctx context.Context) ([]models.RequestMetrics, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store: db cannot be nil")
	}

	query := `
	SELECT 
		user_id::text,
		COUNT(*) as total_requests,
		COUNT(CASE WHEN status_code < 400 THEN 1 END) as success_requests,
		COUNT(CASE WHEN status_code >= 400 THEN 1 END) as error_requests,
		COALESCE(AVG(response_time_ms), 0) as avg_response_time_ms,
		COALESCE(SUM(COALESCE(request_size_bytes, 0) + COALESCE(response_size_bytes, 0)), 0) as total_bytes,
		MAX(created_at) as last_request_at
	FROM requests 
	GROUP BY user_id
	ORDER BY total_requests DESC
	`

	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("store: get all metrics: %w", err)
	}
	defer rows.Close()

	var metrics []models.RequestMetrics
	for rows.Next() {
		var m models.RequestMetrics
		err := rows.Scan(
			&m.UserID,
			&m.TotalRequests,
			&m.SuccessRequests,
			&m.ErrorRequests,
			&m.AvgResponseTimeMs,
			&m.TotalBytes,
			&m.LastRequestAt,
		)
		if err != nil {
			return nil, fmt.Errorf("store: scan metrics: %w", err)
		}
		metrics = append(metrics, m)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate metrics: %w", err)
	}

	return metrics, nil
}

// SaveSubscription inserts or updates a subscription record.
func (s *Store) SaveSubscription(ctx context.Context, sub *models.Subscription) error {
	query := `
INSERT INTO subscriptions (
	user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
	status, current_period_start, current_period_end, cancel_at_period_end, canceled_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (stripe_subscription_id) DO UPDATE SET
	status = EXCLUDED.status,
	current_period_start = EXCLUDED.current_period_start,
	current_period_end = EXCLUDED.current_period_end,
	cancel_at_period_end = EXCLUDED.cancel_at_period_end,
	canceled_at = EXCLUDED.canceled_at,
	updated_at = now()
	`

	_, err := s.db.ExecContext(ctx, query,
		sub.UserID,
		sub.StripeCustomerID,
		sub.StripeSubscriptionID,
		sub.StripePriceID,
		sub.Status,
		sub.CurrentPeriodStart,
		sub.CurrentPeriodEnd,
		sub.CancelAtPeriodEnd,
		sub.CanceledAt,
	)
	if err != nil {
		return fmt.Errorf("store: save subscription: %w", err)
	}

	return nil
}

// GetSubscription retrieves the active subscription for a user by email.
func (s *Store) GetSubscription(ctx context.Context, userEmail string) (*models.Subscription, error) {
	query := `
SELECT
	s.id, s.user_id, s.stripe_customer_id, s.stripe_subscription_id,
	s.stripe_price_id, s.status, s.current_period_start, s.current_period_end,
	s.cancel_at_period_end, s.canceled_at, s.created_at, s.updated_at
FROM subscriptions s
JOIN users u ON s.user_id = u.id
WHERE u.email = $1 AND s.status IN ('active', 'trialing', 'past_due')
ORDER BY s.created_at DESC
LIMIT 1
	`

	var sub models.Subscription
	err := s.db.QueryRowContext(ctx, query, userEmail).Scan(
		&sub.ID,
		&sub.UserID,
		&sub.StripeCustomerID,
		&sub.StripeSubscriptionID,
		&sub.StripePriceID,
		&sub.Status,
		&sub.CurrentPeriodStart,
		&sub.CurrentPeriodEnd,
		&sub.CancelAtPeriodEnd,
		&sub.CanceledAt,
		&sub.CreatedAt,
		&sub.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("store: get subscription: %w", err)
	}

	return &sub, nil
}

// UpdateSubscription updates an existing subscription.
func (s *Store) UpdateSubscription(ctx context.Context, sub *models.Subscription) error {
	query := `
UPDATE subscriptions
SET status = $1,
	current_period_start = $2,
	current_period_end = $3,
	cancel_at_period_end = $4,
	canceled_at = $5,
	updated_at = now()
WHERE id = $6
	`

	_, err := s.db.ExecContext(ctx, query,
		sub.Status,
		sub.CurrentPeriodStart,
		sub.CurrentPeriodEnd,
		sub.CancelAtPeriodEnd,
		sub.CanceledAt,
		sub.ID,
	)
	if err != nil {
		return fmt.Errorf("store: update subscription: %w", err)
	}

	return nil
}

// SavePayment inserts a payment history record.
func (s *Store) SavePayment(ctx context.Context, payment *models.PaymentHistory) error {
	query := `
INSERT INTO payment_history (
	user_id, subscription_id, stripe_customer_id, stripe_payment_intent_id,
	stripe_invoice_id, amount, currency, status, description, receipt_url
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`

	_, err := s.db.ExecContext(ctx, query,
		payment.UserID,
		payment.SubscriptionID,
		payment.StripeCustomerID,
		payment.StripePaymentIntentID,
		payment.StripeInvoiceID,
		payment.Amount,
		payment.Currency,
		payment.Status,
		payment.Description,
		payment.ReceiptURL,
	)
	if err != nil {
		return fmt.Errorf("store: save payment: %w", err)
	}

	return nil
}

// GetPaymentHistory retrieves payment history for a user by email.
func (s *Store) GetPaymentHistory(ctx context.Context, userEmail string) ([]models.PaymentHistory, error) {
	query := `
SELECT
	p.id, p.user_id, p.subscription_id, p.stripe_customer_id,
	p.stripe_payment_intent_id, p.stripe_invoice_id, p.amount,
	p.currency, p.status, p.description, p.receipt_url, p.created_at
FROM payment_history p
JOIN users u ON p.user_id = u.id
WHERE u.email = $1
ORDER BY p.created_at DESC
LIMIT 100
	`

	rows, err := s.db.QueryContext(ctx, query, userEmail)
	if err != nil {
		return nil, fmt.Errorf("store: get payment history: %w", err)
	}
	defer rows.Close()

	var payments []models.PaymentHistory
	for rows.Next() {
		var p models.PaymentHistory
		if err := rows.Scan(
			&p.ID,
			&p.UserID,
			&p.SubscriptionID,
			&p.StripeCustomerID,
			&p.StripePaymentIntentID,
			&p.StripeInvoiceID,
			&p.Amount,
			&p.Currency,
			&p.Status,
			&p.Description,
			&p.ReceiptURL,
			&p.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("store: scan payment: %w", err)
		}
		payments = append(payments, p)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate payments: %w", err)
	}

	return payments, nil
}

// GetUserByEmail retrieves a user by their email address.
func (s *Store) GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	query := `
SELECT id, login, name, email, avatar_url, created_at, updated_at
FROM users
WHERE email = $1
LIMIT 1
	`

	var user models.User
	err := s.db.QueryRowContext(ctx, query, email).Scan(
		&user.ID,
		&user.Login,
		&user.Name,
		&user.Email,
		&user.AvatarURL,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("store: user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("store: get user by email: %w", err)
	}

	return &user, nil
}
