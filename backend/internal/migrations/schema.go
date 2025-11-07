package migrations

import (
	"database/sql"
	"embed"
	"fmt"
	"log"

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

	// Log the current migration version before applying new ones.
	currentVersion := uint(0)
	if v, _, verr := m.Version(); verr == nil {
		currentVersion = v
		log.Printf("migrations: current database schema version: %d", v)
	} else if verr == migrate.ErrNilVersion {
		log.Printf("migrations: no existing migration version (fresh database)")
	} else {
		log.Printf("migrations: unable to determine current version: %v", verr)
	}

	if err := m.Up(); err != nil {
		if err == migrate.ErrNoChange {
			log.Printf("migrations: no new migrations to apply; database is up to date (version %d)", currentVersion)
			return nil
		}
		return fmt.Errorf("migrations: apply: %w", err)
	}

	if v, _, err := m.Version(); err == nil {
		log.Printf("migrations: successfully applied migrations; new schema version: %d", v)
	} else {
		log.Printf("migrations: applied migrations but failed to read new version: %v", err)
	}

	return nil
}
