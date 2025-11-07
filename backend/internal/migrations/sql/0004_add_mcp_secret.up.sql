-- Add per-user MCP secret for multi-tenant identification.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS mcp_secret TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_mcp_secret_key
    ON users (mcp_secret)
    WHERE mcp_secret IS NOT NULL;


