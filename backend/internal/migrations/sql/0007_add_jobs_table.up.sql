-- Create jobs table for async job queue

CREATE TABLE IF NOT EXISTS jobs (
    id BIGSERIAL PRIMARY KEY,
    job_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed, cancelled
    priority TEXT NOT NULL DEFAULT 'normal', -- low, normal, high, critical
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    scheduled_for TIMESTAMPTZ,
    last_error TEXT,
    retry_after TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    worker_id TEXT,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_priority ON jobs(priority);
CREATE INDEX idx_jobs_scheduled_for ON jobs(scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_jobs_status_priority_created ON jobs(status, priority, created_at) WHERE status = 'pending';
CREATE INDEX idx_jobs_worker_id ON jobs(worker_id) WHERE status = 'processing';
