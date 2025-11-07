package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
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
func (s *Store) ListUsers(ctx context.Context, limit int) ([]models.User, error) {
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

	var users []models.User
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

		users = append(users, models.User{
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
		} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
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

// UpsertUserSettings ensures that a Jira settings row exists for the given
// email address and base URL. It will create or update the record in the
// users_settings table identified by (user_id, jira_base_url).
func (s *Store) UpsertUserSettings(ctx context.Context, email, baseURL, apiKey string) error {
	if s == nil || s.db == nil {
		return errors.New("store: db cannot be nil")
	}

	var userID int64
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
		email,
	).Scan(&userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("store: no local user found for email=%s", email)
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
		email,
		apiKey,
	); err != nil {
		return fmt.Errorf("store: upsert users_settings: %w", err)
	}

	return nil
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}
