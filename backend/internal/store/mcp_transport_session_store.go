package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

var ErrMCPTransportSessionNotFound = errors.New("MCP transport session not found")

func (s *Store) CreateMCPTransportSession(ctx context.Context, session *models.MCPTransportSession) error {
	if s == nil || s.db == nil {
		return errors.New("store: db cannot be nil")
	}
	if session == nil {
		return errors.New("store: MCP transport session cannot be nil")
	}

	initRequest := session.InitRequest
	if len(initRequest) == 0 {
		initRequest = []byte(`{}`)
	}

	err := s.db.QueryRowContext(ctx, `
		INSERT INTO mcp_transport_sessions (
			session_id, transport, user_id, init_request, expires_at
		) VALUES ($1, $2, $3, $4, $5)
		RETURNING created_at, updated_at, last_seen_at
	`, session.SessionID, session.Transport, session.UserID, initRequest, session.ExpiresAt).Scan(
		&session.CreatedAt,
		&session.UpdatedAt,
		&session.LastSeenAt,
	)
	if err != nil {
		return fmt.Errorf("store: create MCP transport session: %w", err)
	}

	return nil
}

func (s *Store) GetMCPTransportSession(ctx context.Context, sessionID string) (*models.MCPTransportSession, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store: db cannot be nil")
	}

	session := &models.MCPTransportSession{}
	err := s.db.QueryRowContext(ctx, `
		SELECT
			s.session_id,
			s.transport,
			s.user_id,
			s.init_request,
			s.expires_at,
			s.last_seen_at,
			s.created_at,
			s.updated_at,
			u.login,
			u.email,
			u.name
		FROM mcp_transport_sessions s
		LEFT JOIN users u ON u.id = s.user_id
		WHERE s.session_id = $1 AND s.expires_at > now()
	`, sessionID).Scan(
		&session.SessionID,
		&session.Transport,
		&session.UserID,
		&session.InitRequest,
		&session.ExpiresAt,
		&session.LastSeenAt,
		&session.CreatedAt,
		&session.UpdatedAt,
		&session.UserLogin,
		&session.UserEmail,
		&session.UserName,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrMCPTransportSessionNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("store: get MCP transport session: %w", err)
	}

	return session, nil
}

func (s *Store) TouchMCPTransportSession(ctx context.Context, sessionID string, expiresAt time.Time) error {
	if s == nil || s.db == nil {
		return errors.New("store: db cannot be nil")
	}

	result, err := s.db.ExecContext(ctx, `
		UPDATE mcp_transport_sessions
		SET expires_at = $2, last_seen_at = now(), updated_at = now()
		WHERE session_id = $1 AND expires_at > now()
	`, sessionID, expiresAt)
	if err != nil {
		return fmt.Errorf("store: touch MCP transport session: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("store: read touched MCP transport session rows: %w", err)
	}
	if rows == 0 {
		return ErrMCPTransportSessionNotFound
	}

	return nil
}

func (s *Store) DeleteMCPTransportSession(ctx context.Context, sessionID string) error {
	if s == nil || s.db == nil {
		return errors.New("store: db cannot be nil")
	}

	result, err := s.db.ExecContext(ctx, `DELETE FROM mcp_transport_sessions WHERE session_id = $1`, sessionID)
	if err != nil {
		return fmt.Errorf("store: delete MCP transport session: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("store: read deleted MCP transport session rows: %w", err)
	}
	if rows == 0 {
		return ErrMCPTransportSessionNotFound
	}
	return nil
}

func (s *Store) DeleteExpiredMCPTransportSessions(ctx context.Context) (int64, error) {
	if s == nil || s.db == nil {
		return 0, errors.New("store: db cannot be nil")
	}

	result, err := s.db.ExecContext(ctx, `DELETE FROM mcp_transport_sessions WHERE expires_at <= $1`, time.Now().UTC())
	if err != nil {
		return 0, fmt.Errorf("store: delete expired MCP transport sessions: %w", err)
	}
	return result.RowsAffected()
}
