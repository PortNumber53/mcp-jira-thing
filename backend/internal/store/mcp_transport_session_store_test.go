package store

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

func TestCreateAndGetMCPTransportSession(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	s := &Store{db: db}

	now := time.Now().UTC().Truncate(time.Microsecond)
	userID := int64(42)
	session := &models.MCPTransportSession{
		SessionID:   "session-1",
		Transport:   models.MCPTransportStreamableHTTP,
		UserID:      &userID,
		InitRequest: json.RawMessage(`{"method":"initialize"}`),
		ExpiresAt:   now.Add(time.Hour),
	}

	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO mcp_transport_sessions")).
		WithArgs(session.SessionID, session.Transport, session.UserID, session.InitRequest, session.ExpiresAt).
		WillReturnRows(sqlmock.NewRows([]string{"created_at", "updated_at", "last_seen_at"}).AddRow(now, now, now))

	if err := s.CreateMCPTransportSession(context.Background(), session); err != nil {
		t.Fatalf("create session: %v", err)
	}

	mock.ExpectQuery(regexp.QuoteMeta("FROM mcp_transport_sessions s")).
		WithArgs(session.SessionID).
		WillReturnRows(sqlmock.NewRows([]string{
			"session_id", "transport", "user_id", "init_request", "expires_at", "last_seen_at", "created_at", "updated_at",
			"login", "email", "name",
		}).AddRow(session.SessionID, session.Transport, userID, session.InitRequest, session.ExpiresAt, now, now, now,
			"octocat", "cat@example.com", "Octo Cat"))

	got, err := s.GetMCPTransportSession(context.Background(), session.SessionID)
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if got.SessionID != session.SessionID || got.UserEmail == nil || *got.UserEmail != "cat@example.com" {
		t.Fatalf("unexpected session: %+v", got)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTouchMCPTransportSessionNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	s := &Store{db: db}
	expiresAt := time.Now().UTC().Add(time.Hour)

	mock.ExpectExec(regexp.QuoteMeta("UPDATE mcp_transport_sessions")).
		WithArgs("missing", expiresAt).
		WillReturnResult(sqlmock.NewResult(0, 0))

	if err := s.TouchMCPTransportSession(context.Background(), "missing", expiresAt); err != ErrMCPTransportSessionNotFound {
		t.Fatalf("expected ErrMCPTransportSessionNotFound, got %v", err)
	}
}
