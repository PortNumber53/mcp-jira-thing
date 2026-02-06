package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

// ErrPlanNotFound is returned when a plan is not found
var ErrPlanNotFound = errors.New("plan not found")

// ErrPlanVersionNotFound is returned when a plan version is not found
var ErrPlanVersionNotFound = errors.New("plan version not found")

// PlanStore provides database operations for membership plans
type PlanStore struct {
	db *sql.DB
}

// NewPlanStore creates a new PlanStore instance
func NewPlanStore(db *sql.DB) (*PlanStore, error) {
	if db == nil {
		return nil, errors.New("db cannot be nil")
	}
	return &PlanStore{db: db}, nil
}

// ListPlans returns all active membership plans with their current active version
func (s *PlanStore) ListPlans(ctx context.Context) ([]models.PlanWithCurrentVersion, error) {
	query := `
		SELECT
			mp.id, mp.slug, mp.name, mp.description, mp.tier, mp.is_active, mp.created_at, mp.updated_at,
			pv.id, pv.plan_id, pv.version, pv.stripe_product_id, pv.stripe_price_id,
			pv.price_cents, pv.currency, pv.billing_interval, pv.status,
			pv.deprecated_at, pv.grace_period_days, pv.migration_deadline, pv.archived_at,
			pv.created_at, pv.updated_at
		FROM membership_plans mp
		JOIN plan_versions pv ON pv.plan_id = mp.id AND pv.status = 'active'
		WHERE mp.is_active = TRUE
		ORDER BY mp.tier ASC, pv.version DESC
	`

	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list plans: %w", err)
	}
	defer rows.Close()

	var plans []models.PlanWithCurrentVersion
	for rows.Next() {
		var p models.PlanWithCurrentVersion
		if err := rows.Scan(
			&p.Plan.ID, &p.Plan.Slug, &p.Plan.Name, &p.Plan.Description,
			&p.Plan.Tier, &p.Plan.IsActive, &p.Plan.CreatedAt, &p.Plan.UpdatedAt,
			&p.Version.ID, &p.Version.PlanID, &p.Version.Version,
			&p.Version.StripeProductID, &p.Version.StripePriceID,
			&p.Version.PriceCents, &p.Version.Currency, &p.Version.BillingInterval,
			&p.Version.Status, &p.Version.DeprecatedAt, &p.Version.GracePeriodDays,
			&p.Version.MigrationDeadline, &p.Version.ArchivedAt,
			&p.Version.CreatedAt, &p.Version.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan plan: %w", err)
		}
		plans = append(plans, p)
	}

	return plans, rows.Err()
}

// GetPlanByID returns a plan by its ID
func (s *PlanStore) GetPlanByID(ctx context.Context, id int64) (*models.MembershipPlan, error) {
	query := `SELECT id, slug, name, description, tier, is_active, created_at, updated_at
		FROM membership_plans WHERE id = $1`

	var p models.MembershipPlan
	err := s.db.QueryRowContext(ctx, query, id).Scan(
		&p.ID, &p.Slug, &p.Name, &p.Description,
		&p.Tier, &p.IsActive, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPlanNotFound
		}
		return nil, fmt.Errorf("get plan by id: %w", err)
	}
	return &p, nil
}

// GetPlanBySlug returns a plan by its slug
func (s *PlanStore) GetPlanBySlug(ctx context.Context, slug string) (*models.MembershipPlan, error) {
	query := `SELECT id, slug, name, description, tier, is_active, created_at, updated_at
		FROM membership_plans WHERE slug = $1`

	var p models.MembershipPlan
	err := s.db.QueryRowContext(ctx, query, slug).Scan(
		&p.ID, &p.Slug, &p.Name, &p.Description,
		&p.Tier, &p.IsActive, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPlanNotFound
		}
		return nil, fmt.Errorf("get plan by slug: %w", err)
	}
	return &p, nil
}

// GetActivePlanVersion returns the current active version for a plan
func (s *PlanStore) GetActivePlanVersion(ctx context.Context, planID int64) (*models.PlanVersion, error) {
	query := `
		SELECT id, plan_id, version, stripe_product_id, stripe_price_id,
			price_cents, currency, billing_interval, status,
			deprecated_at, grace_period_days, migration_deadline, archived_at,
			created_at, updated_at
		FROM plan_versions
		WHERE plan_id = $1 AND status = 'active'
		ORDER BY version DESC
		LIMIT 1
	`

	var v models.PlanVersion
	err := s.db.QueryRowContext(ctx, query, planID).Scan(
		&v.ID, &v.PlanID, &v.Version, &v.StripeProductID, &v.StripePriceID,
		&v.PriceCents, &v.Currency, &v.BillingInterval, &v.Status,
		&v.DeprecatedAt, &v.GracePeriodDays, &v.MigrationDeadline, &v.ArchivedAt,
		&v.CreatedAt, &v.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPlanVersionNotFound
		}
		return nil, fmt.Errorf("get active plan version: %w", err)
	}
	return &v, nil
}

// GetPlanVersionByStripePriceID finds a plan version by its Stripe Price ID
func (s *PlanStore) GetPlanVersionByStripePriceID(ctx context.Context, stripePriceID string) (*models.PlanVersion, error) {
	query := `
		SELECT id, plan_id, version, stripe_product_id, stripe_price_id,
			price_cents, currency, billing_interval, status,
			deprecated_at, grace_period_days, migration_deadline, archived_at,
			created_at, updated_at
		FROM plan_versions
		WHERE stripe_price_id = $1
	`

	var v models.PlanVersion
	err := s.db.QueryRowContext(ctx, query, stripePriceID).Scan(
		&v.ID, &v.PlanID, &v.Version, &v.StripeProductID, &v.StripePriceID,
		&v.PriceCents, &v.Currency, &v.BillingInterval, &v.Status,
		&v.DeprecatedAt, &v.GracePeriodDays, &v.MigrationDeadline, &v.ArchivedAt,
		&v.CreatedAt, &v.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPlanVersionNotFound
		}
		return nil, fmt.Errorf("get plan version by stripe price: %w", err)
	}
	return &v, nil
}

// CreatePlanVersion creates a new version of a plan (for price updates)
func (s *PlanStore) CreatePlanVersion(ctx context.Context, v *models.PlanVersion) error {
	query := `
		INSERT INTO plan_versions (plan_id, version, stripe_product_id, stripe_price_id,
			price_cents, currency, billing_interval, status, grace_period_days)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, created_at, updated_at
	`

	return s.db.QueryRowContext(ctx, query,
		v.PlanID, v.Version, v.StripeProductID, v.StripePriceID,
		v.PriceCents, v.Currency, v.BillingInterval, v.Status, v.GracePeriodDays,
	).Scan(&v.ID, &v.CreatedAt, &v.UpdatedAt)
}

// DeprecatePlanVersion marks a plan version as deprecated with a grace period
func (s *PlanStore) DeprecatePlanVersion(ctx context.Context, versionID int64, gracePeriodDays int) error {
	now := time.Now()
	deadline := now.AddDate(0, 0, gracePeriodDays)

	query := `
		UPDATE plan_versions
		SET status = 'deprecated',
			deprecated_at = $2,
			grace_period_days = $3,
			migration_deadline = $4,
			updated_at = now()
		WHERE id = $1 AND status = 'active'
	`

	result, err := s.db.ExecContext(ctx, query, versionID, now, gracePeriodDays, deadline)
	if err != nil {
		return fmt.Errorf("deprecate plan version: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("plan version %d not found or not active", versionID)
	}
	return nil
}

// ArchivePlanVersion marks a deprecated plan version as archived
func (s *PlanStore) ArchivePlanVersion(ctx context.Context, versionID int64) error {
	query := `
		UPDATE plan_versions
		SET status = 'archived',
			archived_at = now(),
			updated_at = now()
		WHERE id = $1 AND status = 'deprecated'
	`

	result, err := s.db.ExecContext(ctx, query, versionID)
	if err != nil {
		return fmt.Errorf("archive plan version: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("plan version %d not found or not deprecated", versionID)
	}
	return nil
}

// UpdatePlanVersionStripeIDs updates the Stripe product/price IDs for a plan version
func (s *PlanStore) UpdatePlanVersionStripeIDs(ctx context.Context, versionID int64, productID, priceID string) error {
	query := `
		UPDATE plan_versions
		SET stripe_product_id = $2, stripe_price_id = $3, updated_at = now()
		WHERE id = $1
	`
	_, err := s.db.ExecContext(ctx, query, versionID, productID, priceID)
	if err != nil {
		return fmt.Errorf("update plan version stripe IDs: %w", err)
	}
	return nil
}

// GetDeprecatedVersionsPastDeadline returns deprecated versions whose grace period has expired
func (s *PlanStore) GetDeprecatedVersionsPastDeadline(ctx context.Context) ([]models.PlanVersion, error) {
	query := `
		SELECT id, plan_id, version, stripe_product_id, stripe_price_id,
			price_cents, currency, billing_interval, status,
			deprecated_at, grace_period_days, migration_deadline, archived_at,
			created_at, updated_at
		FROM plan_versions
		WHERE status = 'deprecated'
		  AND migration_deadline IS NOT NULL
		  AND migration_deadline <= NOW()
		ORDER BY migration_deadline ASC
	`

	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("get deprecated versions past deadline: %w", err)
	}
	defer rows.Close()

	var versions []models.PlanVersion
	for rows.Next() {
		var v models.PlanVersion
		if err := rows.Scan(
			&v.ID, &v.PlanID, &v.Version, &v.StripeProductID, &v.StripePriceID,
			&v.PriceCents, &v.Currency, &v.BillingInterval, &v.Status,
			&v.DeprecatedAt, &v.GracePeriodDays, &v.MigrationDeadline, &v.ArchivedAt,
			&v.CreatedAt, &v.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan deprecated version: %w", err)
		}
		versions = append(versions, v)
	}
	return versions, rows.Err()
}

// GetSubscriptionsByPlanVersion returns all active subscriptions on a specific plan version
func (s *PlanStore) GetSubscriptionsByPlanVersion(ctx context.Context, versionID int64) ([]models.Subscription, error) {
	query := `
		SELECT id, user_id, stripe_customer_id, stripe_subscription_id,
			stripe_price_id, status, current_period_start, current_period_end,
			cancel_at_period_end, canceled_at, created_at, updated_at
		FROM subscriptions
		WHERE plan_version_id = $1 AND status IN ('active', 'trialing', 'past_due')
		ORDER BY created_at ASC
	`

	rows, err := s.db.QueryContext(ctx, query, versionID)
	if err != nil {
		return nil, fmt.Errorf("get subscriptions by plan version: %w", err)
	}
	defer rows.Close()

	var subs []models.Subscription
	for rows.Next() {
		var sub models.Subscription
		if err := rows.Scan(
			&sub.ID, &sub.UserID, &sub.StripeCustomerID, &sub.StripeSubscriptionID,
			&sub.StripePriceID, &sub.Status, &sub.CurrentPeriodStart, &sub.CurrentPeriodEnd,
			&sub.CancelAtPeriodEnd, &sub.CanceledAt, &sub.CreatedAt, &sub.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan subscription: %w", err)
		}
		subs = append(subs, sub)
	}
	return subs, rows.Err()
}

// CountSubscriptionsByPlanVersion returns the count of active subscriptions on a version
func (s *PlanStore) CountSubscriptionsByPlanVersion(ctx context.Context, versionID int64) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM subscriptions WHERE plan_version_id = $1 AND status IN ('active', 'trialing', 'past_due')`,
		versionID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count subscriptions by plan version: %w", err)
	}
	return count, nil
}

// UpdateSubscriptionPlanVersion updates the plan_version_id on a subscription
func (s *PlanStore) UpdateSubscriptionPlanVersion(ctx context.Context, subscriptionID int64, newVersionID int64, newStripePriceID string) error {
	query := `
		UPDATE subscriptions
		SET plan_version_id = $2, stripe_price_id = $3, updated_at = now()
		WHERE id = $1
	`
	_, err := s.db.ExecContext(ctx, query, subscriptionID, newVersionID, newStripePriceID)
	if err != nil {
		return fmt.Errorf("update subscription plan version: %w", err)
	}
	return nil
}

// GetNextPlanVersion returns the next version number for a plan
func (s *PlanStore) GetNextPlanVersion(ctx context.Context, planID int64) (int, error) {
	var maxVersion int
	err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(version), 0) FROM plan_versions WHERE plan_id = $1`,
		planID,
	).Scan(&maxVersion)
	if err != nil {
		return 0, fmt.Errorf("get next plan version: %w", err)
	}
	return maxVersion + 1, nil
}
