-- Add requests table to track MCP API usage metrics

CREATE TABLE IF NOT EXISTS requests (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    response_time_ms INTEGER,
    request_size_bytes INTEGER,
    response_size_bytes INTEGER,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS requests_user_id_idx ON requests (user_id);
CREATE INDEX IF NOT EXISTS requests_created_at_idx ON requests (created_at);
CREATE INDEX IF NOT EXISTS requests_status_code_idx ON requests (status_code);
CREATE INDEX IF NOT EXISTS requests_endpoint_idx ON requests (endpoint);

-- Composite index for user usage analytics
CREATE INDEX IF NOT EXISTS requests_user_created_idx ON requests (user_id, created_at);
