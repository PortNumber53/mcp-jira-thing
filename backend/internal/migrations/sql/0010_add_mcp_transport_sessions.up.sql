CREATE TABLE IF NOT EXISTS mcp_transport_sessions (
    session_id    TEXT PRIMARY KEY,
    transport     TEXT NOT NULL CHECK (transport IN ('sse', 'streamable_http')),
    user_id       BIGINT REFERENCES users(id) ON DELETE CASCADE,
    init_request  JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at    TIMESTAMPTZ NOT NULL,
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_transport_sessions_expires_at
    ON mcp_transport_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_mcp_transport_sessions_user_id
    ON mcp_transport_sessions(user_id);
