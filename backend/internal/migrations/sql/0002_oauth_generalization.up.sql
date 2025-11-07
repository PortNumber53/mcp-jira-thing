-- Generalize users table for multi-provider OAuth and email-based merging.

-- Allow users without a GitHub ID (e.g. Google-only accounts).
ALTER TABLE users
    ALTER COLUMN github_id DROP NOT NULL;

-- Relax the github_id uniqueness constraint and replace it with a partial
-- unique index so multiple non-GitHub users can exist.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM   pg_constraint
        WHERE  conrelid = 'users'::regclass
        AND    conname = 'users_github_id_key'
    ) THEN
        ALTER TABLE users DROP CONSTRAINT users_github_id_key;
    END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS users_github_id_key
    ON users (github_id)
    WHERE github_id IS NOT NULL;

-- Add generic provider identity information directly on the users table.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'github',
    ADD COLUMN IF NOT EXISTS provider_account_id TEXT NOT NULL DEFAULT '';

-- Enforce that a given provider/account pair maps to at most one user.
CREATE UNIQUE INDEX IF NOT EXISTS users_provider_account_unique
    ON users (provider, provider_account_id);

-- Aid case-insensitive email lookups when merging identities.
CREATE INDEX IF NOT EXISTS users_email_ci_idx
    ON users (LOWER(email));

-- Store per-provider avatar URLs on the oauth records.
ALTER TABLE users_oauths
    ADD COLUMN IF NOT EXISTS avatar_url TEXT;
