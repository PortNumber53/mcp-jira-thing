package migrations

import (
	"database/sql"
	"embed"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

// sqlFS contains the embedded SQL migration files.
//
//go:embed sql/*.sql
var sqlFS embed.FS

// Up applies all pending database migrations. It is safe to call multiple
// times; when the database schema is up to date, the function is a no-op.
func Up(db *sql.DB) error {
	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		return fmt.Errorf("migrations: create postgres driver: %w", err)
	}

	sourceDriver, err := iofs.New(sqlFS, "sql")
	if err != nil {
		return fmt.Errorf("migrations: open embedded migrations: %w", err)
	}

	m, err := migrate.NewWithInstance("iofs", sourceDriver, "postgres", driver)
	if err != nil {
		return fmt.Errorf("migrations: init migrate instance: %w", err)
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("migrations: apply: %w", err)
	}

	return nil
}
