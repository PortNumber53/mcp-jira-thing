-- Roll back the MCP secret column and index.

DROP INDEX IF EXISTS users_mcp_secret_key;

ALTER TABLE users
    DROP COLUMN IF EXISTS mcp_secret;
