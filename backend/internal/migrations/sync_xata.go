package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"
)

const xataToPrimaryJobName = "xata_to_primary"

// EnsureMigrationJobsTable creates a small metadata table in the primary DB used
// to record whether one-time migration jobs completed successfully.
func EnsureMigrationJobsTable(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("migrations: ensure migration jobs table: db cannot be nil")
	}
	_, err := db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS mcp_jira_thing_migration_jobs (
  job_name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  run_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT
)`)
	if err != nil {
		return fmt.Errorf("migrations: ensure migration jobs table: %w", err)
	}
	return nil
}

// HasCompletedXataToPrimarySync returns true if the primary DB has recorded a
// successful Xata -> primary sync completion.
func HasCompletedXataToPrimarySync(ctx context.Context, db *sql.DB) (bool, error) {
	if err := EnsureMigrationJobsTable(ctx, db); err != nil {
		return false, err
	}
	var status sql.NullString
	if err := db.QueryRowContext(ctx, `
SELECT status
FROM mcp_jira_thing_migration_jobs
WHERE job_name = $1`, xataToPrimaryJobName).Scan(&status); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("migrations: read migration job status: %w", err)
	}
	return status.Valid && status.String == "completed", nil
}

// SyncXataToPrimary copies data table-by-table from the legacy Xata database into
// the primary (non-Xata) database.
//
// This is intended as a one-way migration helper. It is designed to be safe to
// re-run: inserts use ON CONFLICT DO NOTHING so previously-copied rows are not
// overwritten.
func SyncXataToPrimary(ctx context.Context, xataDB, primaryDB *sql.DB) error {
	if xataDB == nil || primaryDB == nil {
		return fmt.Errorf("migrations: sync: db cannot be nil")
	}

	if err := EnsureMigrationJobsTable(ctx, primaryDB); err != nil {
		return err
	}

	start := time.Now()
	log.Printf("migrations: sync: starting Xata -> primary data copy")

	// Record job start (idempotent).
	if _, err := primaryDB.ExecContext(ctx, `
INSERT INTO mcp_jira_thing_migration_jobs (job_name, status, run_count, started_at, last_error)
VALUES ($1, 'started', 1, now(), NULL)
ON CONFLICT (job_name) DO UPDATE
SET status = 'started',
    run_count = mcp_jira_thing_migration_jobs.run_count + 1,
    started_at = now(),
    completed_at = NULL,
    last_error = NULL
`, xataToPrimaryJobName); err != nil {
		return fmt.Errorf("migrations: sync: record job start: %w", err)
	}

	var syncErr error
	defer func() {
		if syncErr == nil {
			_, _ = primaryDB.ExecContext(ctx, `
UPDATE mcp_jira_thing_migration_jobs
SET status = 'completed',
    completed_at = now(),
    last_error = NULL
WHERE job_name = $1`, xataToPrimaryJobName)
			return
		}
		_, _ = primaryDB.ExecContext(ctx, `
UPDATE mcp_jira_thing_migration_jobs
SET status = 'failed',
    completed_at = NULL,
    last_error = $2
WHERE job_name = $1`, xataToPrimaryJobName, syncErr.Error())
	}()

	if err := syncUsers(ctx, xataDB, primaryDB); err != nil {
		syncErr = err
		return err
	}
	if err := syncUsersOAuths(ctx, xataDB, primaryDB); err != nil {
		syncErr = err
		return err
	}
	if err := syncUsersSettings(ctx, xataDB, primaryDB); err != nil {
		syncErr = err
		return err
	}
	if err := syncSubscriptions(ctx, xataDB, primaryDB); err != nil {
		syncErr = err
		return err
	}
	if err := syncPaymentHistory(ctx, xataDB, primaryDB); err != nil {
		syncErr = err
		return err
	}
	if err := syncRequests(ctx, xataDB, primaryDB); err != nil {
		syncErr = err
		return err
	}

	log.Printf("migrations: sync: completed Xata -> primary data copy in %s", time.Since(start).Round(time.Millisecond))
	return nil
}

func syncUsers(ctx context.Context, from, to *sql.DB) error {
	log.Printf("migrations: sync: users")
	rows, err := from.QueryContext(ctx, `
SELECT
  id,
  login,
  name,
  email,
  avatar_url,
  created_at,
  updated_at,
  provider,
  provider_account_id,
  mcp_secret
FROM users
ORDER BY id`)
	if err != nil {
		return fmt.Errorf("migrations: sync: users: select: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			id                int64
			login             sql.NullString
			name              sql.NullString
			email             sql.NullString
			avatarURL         sql.NullString
			createdAt         sql.NullTime
			updatedAt         sql.NullTime
			provider          sql.NullString
			providerAccountID sql.NullString
			mcpSecret         sql.NullString
		)
		if err := rows.Scan(
			&id,
			&login,
			&name,
			&email,
			&avatarURL,
			&createdAt,
			&updatedAt,
			&provider,
			&providerAccountID,
			&mcpSecret,
		); err != nil {
			return fmt.Errorf("migrations: sync: users: scan: %w", err)
		}

		normalizedLogin := normalizeLogin(id, login, email, provider, providerAccountID)
		normalizedProvider := "github"
		if provider.Valid && provider.String != "" {
			normalizedProvider = provider.String
		}
		normalizedProviderAccountID := ""
		if providerAccountID.Valid {
			normalizedProviderAccountID = providerAccountID.String
		}

		normalizedCreatedAt := time.Now().UTC()
		if createdAt.Valid {
			normalizedCreatedAt = createdAt.Time
		}
		normalizedUpdatedAt := normalizedCreatedAt
		if updatedAt.Valid {
			normalizedUpdatedAt = updatedAt.Time
		}

		if _, err := to.ExecContext(ctx, `
INSERT INTO users (id, login, name, email, avatar_url, created_at, updated_at, provider, provider_account_id, mcp_secret)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT DO NOTHING`,
			id,
			normalizedLogin,
			nullStringToPtr(name),
			nullStringToPtr(email),
			nullStringToPtr(avatarURL),
			normalizedCreatedAt,
			normalizedUpdatedAt,
			normalizedProvider,
			normalizedProviderAccountID,
			nullStringToPtr(mcpSecret),
		); err != nil {
			return fmt.Errorf("migrations: sync: users: insert: %w", err)
		}
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("migrations: sync: users: iterate: %w", err)
	}

	return bumpSequence(ctx, to, "users", "id")
}

func syncUsersOAuths(ctx context.Context, from, to *sql.DB) error {
	log.Printf("migrations: sync: users_oauths")
	rows, err := from.QueryContext(ctx, `
SELECT id, user_id, provider, provider_account_id, access_token, refresh_token, expires_at, scope, created_at, updated_at, avatar_url
FROM users_oauths
ORDER BY id`)
	if err != nil {
		return fmt.Errorf("migrations: sync: users_oauths: select: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			id                int64
			userID            int64
			provider          string
			providerAccountID string
			accessToken       sql.NullString
			refreshToken      sql.NullString
			expiresAt         sql.NullTime
			scope             sql.NullString
			createdAt         time.Time
			updatedAt         time.Time
			avatarURL         sql.NullString
		)
		if err := rows.Scan(
			&id,
			&userID,
			&provider,
			&providerAccountID,
			&accessToken,
			&refreshToken,
			&expiresAt,
			&scope,
			&createdAt,
			&updatedAt,
			&avatarURL,
		); err != nil {
			return fmt.Errorf("migrations: sync: users_oauths: scan: %w", err)
		}

		if _, err := to.ExecContext(ctx, `
INSERT INTO users_oauths (
  id, user_id, provider, provider_account_id, access_token, refresh_token, expires_at, scope, created_at, updated_at, avatar_url
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
ON CONFLICT DO NOTHING`,
			id,
			userID,
			provider,
			providerAccountID,
			nullStringToPtr(accessToken),
			nullStringToPtr(refreshToken),
			nullTimeToPtr(expiresAt),
			nullStringToPtr(scope),
			createdAt,
			updatedAt,
			nullStringToPtr(avatarURL),
		); err != nil {
			return fmt.Errorf("migrations: sync: users_oauths: insert: %w", err)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("migrations: sync: users_oauths: iterate: %w", err)
	}

	return bumpSequence(ctx, to, "users_oauths", "id")
}

func syncUsersSettings(ctx context.Context, from, to *sql.DB) error {
	log.Printf("migrations: sync: users_settings")
	rows, err := from.QueryContext(ctx, `
SELECT id, user_id, jira_base_url, jira_email, jira_api_token, jira_cloud_id, is_default, created_at, updated_at
FROM users_settings
ORDER BY id`)
	if err != nil {
		return fmt.Errorf("migrations: sync: users_settings: select: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			id        int64
			userID    int64
			baseURL   string
			jiraEmail sql.NullString
			apiToken  sql.NullString
			cloudID   sql.NullString
			isDefault bool
			createdAt time.Time
			updatedAt time.Time
		)
		if err := rows.Scan(&id, &userID, &baseURL, &jiraEmail, &apiToken, &cloudID, &isDefault, &createdAt, &updatedAt); err != nil {
			return fmt.Errorf("migrations: sync: users_settings: scan: %w", err)
		}

		if _, err := to.ExecContext(ctx, `
INSERT INTO users_settings (id, user_id, jira_base_url, jira_email, jira_api_token, jira_cloud_id, is_default, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT DO NOTHING`,
			id,
			userID,
			baseURL,
			nullStringToPtr(jiraEmail),
			nullStringToPtr(apiToken),
			nullStringToPtr(cloudID),
			isDefault,
			createdAt,
			updatedAt,
		); err != nil {
			return fmt.Errorf("migrations: sync: users_settings: insert: %w", err)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("migrations: sync: users_settings: iterate: %w", err)
	}

	return bumpSequence(ctx, to, "users_settings", "id")
}

func syncSubscriptions(ctx context.Context, from, to *sql.DB) error {
	log.Printf("migrations: sync: subscriptions")
	rows, err := from.QueryContext(ctx, `
SELECT id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_start, current_period_end, cancel_at_period_end, canceled_at, created_at, updated_at
FROM subscriptions
ORDER BY id`)
	if err != nil {
		return fmt.Errorf("migrations: sync: subscriptions: select: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			id                   int64
			userID               int64
			stripeCustomerID     string
			stripeSubscriptionID string
			stripePriceID        string
			status               string
			currentPeriodStart   sql.NullTime
			currentPeriodEnd     sql.NullTime
			cancelAtPeriodEnd    bool
			canceledAt           sql.NullTime
			createdAt            time.Time
			updatedAt            time.Time
		)
		if err := rows.Scan(
			&id,
			&userID,
			&stripeCustomerID,
			&stripeSubscriptionID,
			&stripePriceID,
			&status,
			&currentPeriodStart,
			&currentPeriodEnd,
			&cancelAtPeriodEnd,
			&canceledAt,
			&createdAt,
			&updatedAt,
		); err != nil {
			return fmt.Errorf("migrations: sync: subscriptions: scan: %w", err)
		}

		if _, err := to.ExecContext(ctx, `
INSERT INTO subscriptions (
  id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status,
  current_period_start, current_period_end, cancel_at_period_end, canceled_at, created_at, updated_at
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
ON CONFLICT DO NOTHING`,
			id,
			userID,
			stripeCustomerID,
			stripeSubscriptionID,
			stripePriceID,
			status,
			nullTimeToPtr(currentPeriodStart),
			nullTimeToPtr(currentPeriodEnd),
			cancelAtPeriodEnd,
			nullTimeToPtr(canceledAt),
			createdAt,
			updatedAt,
		); err != nil {
			return fmt.Errorf("migrations: sync: subscriptions: insert: %w", err)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("migrations: sync: subscriptions: iterate: %w", err)
	}

	return bumpSequence(ctx, to, "subscriptions", "id")
}

func syncPaymentHistory(ctx context.Context, from, to *sql.DB) error {
	log.Printf("migrations: sync: payment_history")
	rows, err := from.QueryContext(ctx, `
SELECT id, user_id, subscription_id, stripe_customer_id, stripe_payment_intent_id, stripe_invoice_id, amount, currency, status, description, receipt_url, created_at
FROM payment_history
ORDER BY id`)
	if err != nil {
		return fmt.Errorf("migrations: sync: payment_history: select: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			id               int64
			userID           int64
			subscriptionID   sql.NullInt64
			stripeCustomerID string
			paymentIntentID  sql.NullString
			invoiceID        sql.NullString
			amount           int
			currency         string
			status           string
			description      sql.NullString
			receiptURL       sql.NullString
			createdAt        time.Time
		)

		if err := rows.Scan(
			&id,
			&userID,
			&subscriptionID,
			&stripeCustomerID,
			&paymentIntentID,
			&invoiceID,
			&amount,
			&currency,
			&status,
			&description,
			&receiptURL,
			&createdAt,
		); err != nil {
			return fmt.Errorf("migrations: sync: payment_history: scan: %w", err)
		}

		if _, err := to.ExecContext(ctx, `
INSERT INTO payment_history (
  id, user_id, subscription_id, stripe_customer_id, stripe_payment_intent_id, stripe_invoice_id,
  amount, currency, status, description, receipt_url, created_at
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
ON CONFLICT DO NOTHING`,
			id,
			userID,
			nullInt64ToPtr(subscriptionID),
			stripeCustomerID,
			nullStringToPtr(paymentIntentID),
			nullStringToPtr(invoiceID),
			amount,
			currency,
			status,
			nullStringToPtr(description),
			nullStringToPtr(receiptURL),
			createdAt,
		); err != nil {
			return fmt.Errorf("migrations: sync: payment_history: insert: %w", err)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("migrations: sync: payment_history: iterate: %w", err)
	}

	return bumpSequence(ctx, to, "payment_history", "id")
}

func syncRequests(ctx context.Context, from, to *sql.DB) error {
	log.Printf("migrations: sync: requests")
	rows, err := from.QueryContext(ctx, `
SELECT id, user_id, method, endpoint, status_code, response_time_ms, request_size_bytes, response_size_bytes, error_message, created_at
FROM requests
ORDER BY id`)
	if err != nil {
		return fmt.Errorf("migrations: sync: requests: select: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			id                int64
			userID            int64
			method            string
			endpoint          string
			statusCode        int
			responseTimeMs    sql.NullInt64
			requestSizeBytes  sql.NullInt64
			responseSizeBytes sql.NullInt64
			errorMessage      sql.NullString
			createdAt         time.Time
		)
		if err := rows.Scan(&id, &userID, &method, &endpoint, &statusCode, &responseTimeMs, &requestSizeBytes, &responseSizeBytes, &errorMessage, &createdAt); err != nil {
			return fmt.Errorf("migrations: sync: requests: scan: %w", err)
		}

		if _, err := to.ExecContext(ctx, `
INSERT INTO requests (
  id, user_id, method, endpoint, status_code, response_time_ms, request_size_bytes, response_size_bytes, error_message, created_at
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT DO NOTHING`,
			id,
			userID,
			method,
			endpoint,
			statusCode,
			nullInt64ToPtr(responseTimeMs),
			nullInt64ToPtr(requestSizeBytes),
			nullInt64ToPtr(responseSizeBytes),
			nullStringToPtr(errorMessage),
			createdAt,
		); err != nil {
			return fmt.Errorf("migrations: sync: requests: insert: %w", err)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("migrations: sync: requests: iterate: %w", err)
	}

	return bumpSequence(ctx, to, "requests", "id")
}

func bumpSequence(ctx context.Context, db *sql.DB, table, column string) error {
	// Make sure future inserts don't collide with imported IDs.
	// pg_get_serial_sequence returns the backing sequence name for a serial/bigserial column.
	_, err := db.ExecContext(ctx, fmt.Sprintf(`
SELECT setval(
  pg_get_serial_sequence('%s','%s'),
  COALESCE((SELECT MAX(%s) FROM %s), 1),
  true
)`, table, column, column, table))
	if err != nil {
		return fmt.Errorf("migrations: sync: bump sequence for %s.%s: %w", table, column, err)
	}
	return nil
}

func nullStringToPtr(v sql.NullString) any {
	if !v.Valid {
		return nil
	}
	return v.String
}

func nullTimeToPtr(v sql.NullTime) any {
	if !v.Valid {
		return nil
	}
	return v.Time
}

func nullInt64ToPtr(v sql.NullInt64) any {
	if !v.Valid {
		return nil
	}
	return v.Int64
}

func normalizeLogin(id int64, login, email, provider, providerAccountID sql.NullString) string {
	if login.Valid && strings.TrimSpace(login.String) != "" {
		return login.String
	}
	if email.Valid && strings.TrimSpace(email.String) != "" {
		return email.String
	}
	if providerAccountID.Valid && strings.TrimSpace(providerAccountID.String) != "" {
		if provider.Valid && strings.TrimSpace(provider.String) != "" {
			return fmt.Sprintf("%s:%s", provider.String, providerAccountID.String)
		}
		return providerAccountID.String
	}
	return fmt.Sprintf("user-%d", id)
}
