-- Remove the github_id column from users now that provider/provider_account_id
-- and users_oauths store provider-specific accounts.

-- Drop the partial unique index if it exists.
DROP INDEX IF EXISTS users_github_id_key;

-- Drop the column itself. Existing data should already be represented via
-- users_oauths.provider_account_id for the "github" provider.
ALTER TABLE users
    DROP COLUMN IF EXISTS github_id;
