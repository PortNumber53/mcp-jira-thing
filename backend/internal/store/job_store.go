package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
)

// ErrJobNotFound is returned when a job is not found in the database
var ErrJobNotFound = errors.New("job not found")

// JobStore provides database operations for job queue management
type JobStore struct {
	db *sql.DB
}

// NewJobStore creates a new JobStore instance
func NewJobStore(db *sql.DB) (*JobStore, error) {
	if db == nil {
		return nil, errors.New("db cannot be nil")
	}
	return &JobStore{db: db}, nil
}

// Enqueue creates a new job in the queue
func (s *JobStore) Enqueue(ctx context.Context, job *models.Job) error {
	if err := job.IsValid(); err != nil {
		return fmt.Errorf("invalid job: %w", err)
	}

	query := `
		INSERT INTO jobs (job_type, payload, status, priority, max_attempts, scheduled_for, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at, updated_at
	`

	status := models.JobStatusPending
	if job.Status != "" {
		status = job.Status
	}

	err := s.db.QueryRowContext(
		ctx,
		query,
		job.JobType,
		job.Payload,
		status,
		job.Priority,
		job.MaxAttempts,
		job.ScheduledFor,
		job.Metadata,
	).Scan(&job.ID, &job.CreatedAt, &job.UpdatedAt)

	if err != nil {
		return fmt.Errorf("enqueue job: %w", err)
	}

	return nil
}

// GetByID retrieves a job by its ID
func (s *JobStore) GetByID(ctx context.Context, id int64) (*models.Job, error) {
	query := `
		SELECT id, job_type, payload, status, priority, attempts, max_attempts,
		       created_at, updated_at, scheduled_for, last_error, retry_after,
		       processed_at, completed_at, worker_id, metadata
		FROM jobs
		WHERE id = $1
	`

	job := &models.Job{}
	var payloadJSON, metadataJSON []byte

	err := s.db.QueryRowContext(ctx, query, id).Scan(
		&job.ID,
		&job.JobType,
		&payloadJSON,
		&job.Status,
		&job.Priority,
		&job.Attempts,
		&job.MaxAttempts,
		&job.CreatedAt,
		&job.UpdatedAt,
		&job.ScheduledFor,
		&job.LastError,
		&job.RetryAfter,
		&job.ProcessedAt,
		&job.CompletedAt,
		&job.WorkerID,
		&metadataJSON,
	)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrJobNotFound
		}
		return nil, fmt.Errorf("get job by id: %w", err)
	}

	// Unmarshal JSONB fields
	if len(payloadJSON) > 0 {
		job.Payload = make(models.JSONB)
		if err := json.Unmarshal(payloadJSON, &job.Payload); err != nil {
			return nil, fmt.Errorf("unmarshal payload: %w", err)
		}
	}
	if len(metadataJSON) > 0 {
		job.Metadata = make(models.JSONB)
		if err := json.Unmarshal(metadataJSON, &job.Metadata); err != nil {
			return nil, fmt.Errorf("unmarshal metadata: %w", err)
		}
	}

	return job, nil
}

// ClaimNextJob atomically claims the next available job for processing
func (s *JobStore) ClaimNextJob(ctx context.Context, workerID string) (*models.Job, error) {
	query := `
		UPDATE jobs
		SET status = 'processing',
		    worker_id = $1,
		    processed_at = NOW(),
		    updated_at = NOW(),
		    attempts = attempts + 1
		WHERE id = (
			SELECT id FROM jobs
			WHERE status = 'pending'
			  AND (scheduled_for IS NULL OR scheduled_for <= NOW())
			  AND (retry_after IS NULL OR retry_after <= NOW())
			ORDER BY 
				CASE priority
					WHEN 'critical' THEN 4
					WHEN 'high' THEN 3
					WHEN 'normal' THEN 2
					WHEN 'low' THEN 1
				END DESC,
				created_at ASC
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id, job_type, payload, status, priority, attempts, max_attempts,
		          created_at, updated_at, scheduled_for, last_error, retry_after,
		          processed_at, completed_at, worker_id, metadata
	`

	job := &models.Job{}
	var payloadJSON, metadataJSON []byte

	err := s.db.QueryRowContext(ctx, query, workerID).Scan(
		&job.ID,
		&job.JobType,
		&payloadJSON,
		&job.Status,
		&job.Priority,
		&job.Attempts,
		&job.MaxAttempts,
		&job.CreatedAt,
		&job.UpdatedAt,
		&job.ScheduledFor,
		&job.LastError,
		&job.RetryAfter,
		&job.ProcessedAt,
		&job.CompletedAt,
		&job.WorkerID,
		&metadataJSON,
	)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil // No jobs available
		}
		return nil, fmt.Errorf("claim next job: %w", err)
	}

	// Unmarshal JSONB fields
	if len(payloadJSON) > 0 {
		job.Payload = make(models.JSONB)
		if err := json.Unmarshal(payloadJSON, &job.Payload); err != nil {
			return nil, fmt.Errorf("unmarshal payload: %w", err)
		}
	}
	if len(metadataJSON) > 0 {
		job.Metadata = make(models.JSONB)
		if err := json.Unmarshal(metadataJSON, &job.Metadata); err != nil {
			return nil, fmt.Errorf("unmarshal metadata: %w", err)
		}
	}

	return job, nil
}

// MarkCompleted marks a job as successfully completed
func (s *JobStore) MarkCompleted(ctx context.Context, id int64) error {
	query := `
		UPDATE jobs
		SET status = 'completed',
		    completed_at = NOW(),
		    updated_at = NOW(),
		    worker_id = NULL
		WHERE id = $1
	`

	_, err := s.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("mark job completed: %w", err)
	}

	return nil
}

// MarkFailed marks a job as failed with an error message
func (s *JobStore) MarkFailed(ctx context.Context, id int64, errorMsg string) error {
	query := `
		UPDATE jobs
		SET status = 'failed',
		    last_error = $2,
		    updated_at = NOW(),
		    worker_id = NULL
		WHERE id = $1
	`

	_, err := s.db.ExecContext(ctx, query, id, errorMsg)
	if err != nil {
		return fmt.Errorf("mark job failed: %w", err)
	}

	return nil
}

// ScheduleRetry schedules a job for retry with exponential backoff
func (s *JobStore) ScheduleRetry(ctx context.Context, id int64, errorMsg string, retryAfter time.Time) error {
	query := `
		UPDATE jobs
		SET status = 'pending',
		    last_error = $2,
		    retry_after = $3,
		    updated_at = NOW(),
		    worker_id = NULL
		WHERE id = $1
	`

	_, err := s.db.ExecContext(ctx, query, id, errorMsg, retryAfter)
	if err != nil {
		return fmt.Errorf("schedule job retry: %w", err)
	}

	return nil
}

// CancelJob marks a job as cancelled
func (s *JobStore) CancelJob(ctx context.Context, id int64) error {
	query := `
		UPDATE jobs
		SET status = 'cancelled',
		    updated_at = NOW(),
		    worker_id = NULL
		WHERE id = $1 AND status IN ('pending', 'failed')
	`

	result, err := s.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("cancel job: %w", err)
	}

	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("job cannot be cancelled (may be processing or already completed)")
	}

	return nil
}

// ReleaseJob releases a processing job back to pending (for graceful shutdown)
func (s *JobStore) ReleaseJob(ctx context.Context, id int64) error {
	query := `
		UPDATE jobs
		SET status = 'pending',
		    worker_id = NULL,
		    updated_at = NOW()
		WHERE id = $1 AND status = 'processing'
	`

	_, err := s.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("release job: %w", err)
	}

	return nil
}

// GetStats returns statistics about the job queue
func (s *JobStore) GetStats(ctx context.Context) (*models.JobStats, error) {
	query := `
		SELECT 
			COUNT(*) FILTER (WHERE status = 'pending') as pending,
			COUNT(*) FILTER (WHERE status = 'processing') as processing,
			COUNT(*) FILTER (WHERE status = 'completed') as completed,
			COUNT(*) FILTER (WHERE status = 'failed') as failed,
			COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
			COUNT(*) as total
		FROM jobs
	`

	stats := &models.JobStats{}
	err := s.db.QueryRowContext(ctx, query).Scan(
		&stats.Pending,
		&stats.Processing,
		&stats.Completed,
		&stats.Failed,
		&stats.Cancelled,
		&stats.Total,
	)
	if err != nil {
		return nil, fmt.Errorf("get job stats: %w", err)
	}

	return stats, nil
}

// ListProcessingJobs returns all jobs currently being processed
func (s *JobStore) ListProcessingJobs(ctx context.Context) ([]*models.Job, error) {
	query := `
		SELECT id, job_type, payload, status, priority, attempts, max_attempts,
		       created_at, updated_at, scheduled_for, last_error, retry_after,
		       processed_at, completed_at, worker_id, metadata
		FROM jobs
		WHERE status = 'processing'
		ORDER BY processed_at ASC
	`

	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list processing jobs: %w", err)
	}
	defer rows.Close()

	return s.scanJobs(rows)
}

// ListPendingJobs returns pending jobs ordered by priority and creation time
func (s *JobStore) ListPendingJobs(ctx context.Context, limit int) ([]*models.Job, error) {
	if limit <= 0 {
		limit = 100
	}

	query := `
		SELECT id, job_type, payload, status, priority, attempts, max_attempts,
		       created_at, updated_at, scheduled_for, last_error, retry_after,
		       processed_at, completed_at, worker_id, metadata
		FROM jobs
		WHERE status = 'pending'
		  AND (scheduled_for IS NULL OR scheduled_for <= NOW())
		  AND (retry_after IS NULL OR retry_after <= NOW())
		ORDER BY 
			CASE priority
				WHEN 'critical' THEN 4
				WHEN 'high' THEN 3
				WHEN 'normal' THEN 2
				WHEN 'low' THEN 1
			END DESC,
			created_at ASC
		LIMIT $1
	`

	rows, err := s.db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("list pending jobs: %w", err)
	}
	defer rows.Close()

	return s.scanJobs(rows)
}

// scanJobs scans multiple job rows
func (s *JobStore) scanJobs(rows *sql.Rows) ([]*models.Job, error) {
	var jobs []*models.Job

	for rows.Next() {
		job := &models.Job{}
		var payloadJSON, metadataJSON []byte

		err := rows.Scan(
			&job.ID,
			&job.JobType,
			&payloadJSON,
			&job.Status,
			&job.Priority,
			&job.Attempts,
			&job.MaxAttempts,
			&job.CreatedAt,
			&job.UpdatedAt,
			&job.ScheduledFor,
			&job.LastError,
			&job.RetryAfter,
			&job.ProcessedAt,
			&job.CompletedAt,
			&job.WorkerID,
			&metadataJSON,
		)
		if err != nil {
			return nil, fmt.Errorf("scan job: %w", err)
		}

		// Unmarshal JSONB fields
		if len(payloadJSON) > 0 {
			job.Payload = make(models.JSONB)
			if err := json.Unmarshal(payloadJSON, &job.Payload); err != nil {
				return nil, fmt.Errorf("unmarshal payload: %w", err)
			}
		}
		if len(metadataJSON) > 0 {
			job.Metadata = make(models.JSONB)
			if err := json.Unmarshal(metadataJSON, &job.Metadata); err != nil {
				return nil, fmt.Errorf("unmarshal metadata: %w", err)
			}
		}

		jobs = append(jobs, job)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate jobs: %w", err)
	}

	return jobs, nil
}

// CleanupOldJobs removes completed/failed jobs older than the specified duration
func (s *JobStore) CleanupOldJobs(ctx context.Context, olderThan time.Duration) (int64, error) {
	query := `
		DELETE FROM jobs
		WHERE status IN ('completed', 'failed', 'cancelled')
		  AND updated_at < NOW() - INTERVAL '1 second' * $1
	`

	result, err := s.db.ExecContext(ctx, query, olderThan.Seconds())
	if err != nil {
		return 0, fmt.Errorf("cleanup old jobs: %w", err)
	}

	affected, _ := result.RowsAffected()
	return affected, nil
}
