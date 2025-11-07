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
// the local users and users_oauths tables. It is idempotent with respect to
// the GitHub ID and provider account ID.
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

	var userID int64
	err = tx.QueryRowContext(
		ctx,
		`INSERT INTO users (github_id, login, name, email, avatar_url)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (github_id) DO UPDATE
		 SET login = EXCLUDED.login,
		     name = EXCLUDED.name,
		     email = EXCLUDED.email,
		     avatar_url = EXCLUDED.avatar_url,
		     updated_at = now()
		 RETURNING id`,
		user.GitHubID,
		user.Login,
		user.Name,
		user.Email,
		user.AvatarURL,
	).Scan(&userID)
	if err != nil {
		return fmt.Errorf("store: upsert users: %w", err)
	}

	scope := ""
	if user.Scope != nil {
		scope = *user.Scope
	}

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO users_oauths (user_id, provider, provider_account_id, access_token, scope)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (provider, provider_account_id) DO UPDATE
		 SET access_token = EXCLUDED.access_token,
		     scope = EXCLUDED.scope,
		     updated_at = now()`,
		userID,
		"github",
		strconv.FormatInt(user.GitHubID, 10),
		user.AccessToken,
		scope,
	); err != nil {
		return fmt.Errorf("store: upsert users_oauths: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: commit upsert github user tx: %w", err)
	}

	return nil
}

// UpsertUserSettings ensures that a Jira settings row exists for the given
// GitHub user and base URL. It will create or update the record in the
// users_settings table identified by (user_id, jira_base_url).
func (s *Store) UpsertUserSettings(ctx context.Context, githubID int64, baseURL, email, apiKey string) error {
	if s == nil || s.db == nil {
		return errors.New("store: db cannot be nil")
	}

	var userID int64
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT id FROM users WHERE github_id = $1`,
		githubID,
	).Scan(&userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("store: no local user found for github_id=%d", githubID)
		}
		return fmt.Errorf("store: lookup user by github_id: %w", err)
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
