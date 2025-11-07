-- Best-effort rollback of the OAuth generalisation changes.

-- Drop indexes/columns that were added in the up migration.
DROP INDEX IF EXISTS users_provider_account_unique;
DROP INDEX IF EXISTS users_email_ci_idx;

ALTER TABLE users
    DROP COLUMN IF EXISTS provider,
    DROP COLUMN IF EXISTS provider_account_id;

ALTER TABLE users_oauths
    DROP COLUMN IF EXISTS avatar_url;

-- Attempt to restore NOT NULL constraint on github_id. This will fail if any
-- rows currently contain a NULL github_id, so this down migration is mainly
-- informational.
ALTER TABLE users
    ALTER COLUMN github_id SET NOT NULL;
