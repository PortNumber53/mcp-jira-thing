package store

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestNewStoreValidation(t *testing.T) {
	if _, err := New(nil); err == nil {
		t.Fatal("expected error when db is nil")
	}
}

func TestListUsersSuccess(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	s := &Store{db: db}
	t.Cleanup(func() {
		db.Close()
	})

	query := regexp.MustCompile(`SELECT\s+id::text\s+AS id`)
	rows := sqlmock.NewRows([]string{"id", "email", "name", "image"}).
		AddRow("1", "user@example.com", "User", "https://avatar")

	mock.ExpectQuery(query.String()).WithArgs(5).WillReturnRows(rows)

	users, err := s.ListUsers(context.Background(), 5)
	if err != nil {
		t.Fatalf("ListUsers returned error: %v", err)
	}

	if len(users) != 1 {
		t.Fatalf("expected 1 user, got %d", len(users))
	}
	if users[0].ID != "1" {
		t.Fatalf("unexpected id: %s", users[0].ID)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestListUsersQueryError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	s := &Store{db: db}
	t.Cleanup(func() {
		db.Close()
	})

	query := regexp.MustCompile(`SELECT\s+id::text\s+AS id`)
	mock.ExpectQuery(query.String()).WithArgs(defaultPageSize).WillReturnError(errors.New("boom"))

	if _, err := s.ListUsers(context.Background(), 0); err == nil {
		t.Fatal("expected error when query fails")
	}
}
