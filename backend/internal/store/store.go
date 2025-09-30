package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

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

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}
