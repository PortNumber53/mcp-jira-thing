package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"
)

// JobStatus represents the current state of a job in the queue
type JobStatus string

const (
	JobStatusPending    JobStatus = "pending"
	JobStatusProcessing JobStatus = "processing"
	JobStatusCompleted  JobStatus = "completed"
	JobStatusFailed     JobStatus = "failed"
	JobStatusCancelled  JobStatus = "cancelled"
)

// JobPriority represents the priority level for job processing
type JobPriority string

const (
	JobPriorityLow      JobPriority = "low"
	JobPriorityNormal   JobPriority = "normal"
	JobPriorityHigh     JobPriority = "high"
	JobPriorityCritical JobPriority = "critical"
)

// PriorityWeights maps priorities to numeric weights for sorting
var PriorityWeights = map[JobPriority]int{
	JobPriorityCritical: 100,
	JobPriorityHigh:     75,
	JobPriorityNormal:   50,
	JobPriorityLow:      25,
}

// Job represents an asynchronous job in the queue
type Job struct {
	ID           int64           `json:"id"`
	JobType      string          `json:"job_type"`
	Payload      JSONB           `json:"payload"`
	Status       JobStatus       `json:"status"`
	Priority     JobPriority     `json:"priority"`
	Attempts     int             `json:"attempts"`
	MaxAttempts  int             `json:"max_attempts"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
	ScheduledFor *time.Time      `json:"scheduled_for,omitempty"`
	LastError    *string         `json:"last_error,omitempty"`
	RetryAfter   *time.Time      `json:"retry_after,omitempty"`
	ProcessedAt  *time.Time      `json:"processed_at,omitempty"`
	CompletedAt  *time.Time      `json:"completed_at,omitempty"`
	WorkerID     *string         `json:"worker_id,omitempty"`
	Metadata     JSONB           `json:"metadata"`
}

// JSONB is a custom type for PostgreSQL JSONB columns
type JSONB map[string]interface{}

// Value implements the driver.Valuer interface for JSONB
func (j JSONB) Value() (driver.Value, error) {
	if j == nil {
		return json.Marshal(map[string]interface{}{})
	}
	return json.Marshal(j)
}

// Scan implements the sql.Scanner interface for JSONB
func (j *JSONB) Scan(value interface{}) error {
	if value == nil {
		*j = JSONB{}
		return nil
	}

	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return fmt.Errorf("cannot scan type %T into JSONB", value)
	}

	return json.Unmarshal(bytes, j)
}

// JobStats holds statistics about the job queue
type JobStats struct {
	Pending    int `json:"pending"`
	Processing int `json:"processing"`
	Completed  int `json:"completed"`
	Failed     int `json:"failed"`
	Cancelled  int `json:"cancelled"`
	Total      int `json:"total"`
}

// IsValid checks if the job is in a valid state for processing
func (j *Job) IsValid() error {
	if j.JobType == "" {
		return fmt.Errorf("job type is required")
	}
	if j.MaxAttempts < 1 {
		return fmt.Errorf("max_attempts must be at least 1")
	}
	if j.Priority == "" {
		j.Priority = JobPriorityNormal
	}
	return nil
}

// CanRetry checks if the job can be retried
func (j *Job) CanRetry() bool {
	return j.Attempts < j.MaxAttempts && j.Status != JobStatusCancelled
}

// ShouldProcess checks if the job is ready to be processed
func (j *Job) ShouldProcess() bool {
	if j.Status != JobStatusPending {
		return false
	}
	if j.ScheduledFor != nil && j.ScheduledFor.After(time.Now()) {
		return false
	}
	if j.RetryAfter != nil && j.RetryAfter.After(time.Now()) {
		return false
	}
	return true
}
