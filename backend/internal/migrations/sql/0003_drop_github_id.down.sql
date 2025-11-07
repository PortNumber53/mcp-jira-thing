-- Best-effort rollback for github_id removal. Recreate the column as nullable
-- and restore the partial unique index.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS github_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS users_github_id_key
    ON users (github_id)
    WHERE github_id IS NOT NULL;
