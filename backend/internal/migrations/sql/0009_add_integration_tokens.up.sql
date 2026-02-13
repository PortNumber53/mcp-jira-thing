-- Integration tokens table stores OAuth tokens for third-party integrations
-- (e.g. Google Docs, Slack) per user. Each user can have one token per provider.
CREATE TABLE IF NOT EXISTS integration_tokens (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL,           -- e.g. 'google_docs', 'slack'
    access_token  TEXT NOT NULL,
    refresh_token TEXT,
    token_type    TEXT DEFAULT 'Bearer',
    expires_at    TIMESTAMPTZ,
    scopes        TEXT,                    -- space-separated OAuth scopes
    metadata      JSONB DEFAULT '{}',      -- provider-specific metadata (e.g. team name, workspace)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_integration_tokens_user_id ON integration_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_integration_tokens_provider ON integration_tokens(provider);
