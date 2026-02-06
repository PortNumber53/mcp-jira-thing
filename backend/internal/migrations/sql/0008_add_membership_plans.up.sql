-- Membership plans with versioning for price migration support
-- Supports 3 membership levels: free, basic, premium

CREATE TABLE IF NOT EXISTS membership_plans (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL,                          -- e.g. 'free', 'basic', 'premium'
    name TEXT NOT NULL,                          -- Display name
    description TEXT,
    tier INTEGER NOT NULL DEFAULT 0,             -- 0=free, 1=basic, 2=premium (for ordering/gating)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,     -- Whether this plan is available for new signups
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(slug)
);

CREATE TABLE IF NOT EXISTS plan_versions (
    id BIGSERIAL PRIMARY KEY,
    plan_id BIGINT NOT NULL REFERENCES membership_plans(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    stripe_product_id TEXT,                      -- Stripe Product ID (null for free tier)
    stripe_price_id TEXT,                        -- Stripe Price ID (null for free tier)
    price_cents INTEGER NOT NULL DEFAULT 0,      -- Price in cents (0 for free)
    currency TEXT NOT NULL DEFAULT 'usd',
    billing_interval TEXT NOT NULL DEFAULT 'month', -- 'month' or 'year'
    status TEXT NOT NULL DEFAULT 'active',        -- active, deprecated, archived
    deprecated_at TIMESTAMPTZ,
    grace_period_days INTEGER NOT NULL DEFAULT 0, -- Days before auto-migration
    migration_deadline TIMESTAMPTZ,               -- Computed: deprecated_at + grace_period_days
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(plan_id, version)
);

CREATE INDEX idx_plan_versions_plan_id ON plan_versions(plan_id);
CREATE INDEX idx_plan_versions_status ON plan_versions(status);
CREATE INDEX idx_plan_versions_stripe_price_id ON plan_versions(stripe_price_id);
CREATE INDEX idx_plan_versions_migration_deadline ON plan_versions(migration_deadline)
    WHERE status = 'deprecated' AND migration_deadline IS NOT NULL;

-- Track which plan version each user subscription is on
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_version_id BIGINT REFERENCES plan_versions(id);
CREATE INDEX idx_subscriptions_plan_version_id ON subscriptions(plan_version_id);

-- Seed the 3 membership levels
INSERT INTO membership_plans (slug, name, description, tier) VALUES
    ('free', 'Free', 'Basic access with limited features', 0),
    ('basic', 'Basic', 'Standard features for individuals', 1),
    ('premium', 'Premium', 'Full access with all features', 2)
ON CONFLICT (slug) DO NOTHING;

-- Create initial plan versions (prices to be set via Stripe setup)
INSERT INTO plan_versions (plan_id, version, price_cents, currency, billing_interval, status)
SELECT id, 1, 0, 'usd', 'month', 'active'
FROM membership_plans WHERE slug = 'free'
ON CONFLICT (plan_id, version) DO NOTHING;

INSERT INTO plan_versions (plan_id, version, price_cents, currency, billing_interval, status)
SELECT id, 1, 999, 'usd', 'month', 'active'
FROM membership_plans WHERE slug = 'basic'
ON CONFLICT (plan_id, version) DO NOTHING;

INSERT INTO plan_versions (plan_id, version, price_cents, currency, billing_interval, status)
SELECT id, 1, 2999, 'usd', 'month', 'active'
FROM membership_plans WHERE slug = 'premium'
ON CONFLICT (plan_id, version) DO NOTHING;
