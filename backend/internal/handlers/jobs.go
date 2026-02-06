package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/store"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/worker"
	"github.com/go-chi/chi/v5"
)

// JobStore defines the interface for job storage operations
type JobStore interface {
	Enqueue(ctx context.Context, job *models.Job) error
	GetByID(ctx context.Context, id int64) (*models.Job, error)
	CancelJob(ctx context.Context, id int64) error
	GetStats(ctx context.Context) (*models.JobStats, error)
	ListPendingJobs(ctx context.Context, limit int) ([]*models.Job, error)
	ListProcessingJobs(ctx context.Context) ([]*models.Job, error)
}

// CreateJobRequest represents a request to create a new job
type CreateJobRequest struct {
	JobType      string                 `json:"job_type"`
	Payload      map[string]interface{} `json:"payload"`
	Priority     string                 `json:"priority,omitempty"`
	MaxAttempts  int                    `json:"max_attempts,omitempty"`
	ScheduledFor *time.Time             `json:"scheduled_for,omitempty"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

// CreateJob creates a new job in the queue
func CreateJob(jobStore JobStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req CreateJobRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Printf("CreateJob: invalid JSON payload: %v", err)
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}

		// Validate required fields
		if req.JobType == "" {
			http.Error(w, "job_type is required", http.StatusBadRequest)
			return
		}

		// Set defaults
		priority := models.JobPriorityNormal
		if req.Priority != "" {
			priority = models.JobPriority(req.Priority)
		}

		maxAttempts := 3
		if req.MaxAttempts > 0 {
			maxAttempts = req.MaxAttempts
		}

		job := &models.Job{
			JobType:      req.JobType,
			Payload:      req.Payload,
			Priority:     priority,
			MaxAttempts:  maxAttempts,
			ScheduledFor: req.ScheduledFor,
			Metadata:     req.Metadata,
		}

		if err := jobStore.Enqueue(r.Context(), job); err != nil {
			log.Printf("CreateJob: failed to enqueue job: %v", err)
			http.Error(w, "failed to create job", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"id":      job.ID,
			"status":  job.Status,
			"message": "Job created successfully",
		}); err != nil {
			log.Printf("CreateJob: failed to encode response: %v", err)
		}
	}
}

// GetJob retrieves a job by ID
func GetJob(jobStore JobStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Extract job ID from URL
		jobIDStr := r.URL.Query().Get("id")
		if jobIDStr == "" {
			// Try to get from path if using chi router patterns
			jobIDStr = chi.URLParam(r, "id")
		}

		if jobIDStr == "" {
			http.Error(w, "job ID is required", http.StatusBadRequest)
			return
		}

		jobID, err := strconv.ParseInt(jobIDStr, 10, 64)
		if err != nil {
			http.Error(w, "invalid job ID", http.StatusBadRequest)
			return
		}

		job, err := jobStore.GetByID(r.Context(), jobID)
		if err != nil {
			if err == store.ErrJobNotFound {
				http.Error(w, "job not found", http.StatusNotFound)
				return
			}
			log.Printf("GetJob: failed to get job %d: %v", jobID, err)
			http.Error(w, "failed to retrieve job", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(job); err != nil {
			log.Printf("GetJob: failed to encode response: %v", err)
		}
	}
}

// CancelJob cancels a pending or failed job
func CancelJob(jobStore JobStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Extract job ID from URL
		jobIDStr := r.URL.Query().Get("id")
		if jobIDStr == "" {
			jobIDStr = chi.URLParam(r, "id")
		}

		if jobIDStr == "" {
			http.Error(w, "job ID is required", http.StatusBadRequest)
			return
		}

		jobID, err := strconv.ParseInt(jobIDStr, 10, 64)
		if err != nil {
			http.Error(w, "invalid job ID", http.StatusBadRequest)
			return
		}

		if err := jobStore.CancelJob(r.Context(), jobID); err != nil {
			log.Printf("CancelJob: failed to cancel job %d: %v", jobID, err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"id":      jobID,
			"message": "Job cancelled successfully",
		}); err != nil {
			log.Printf("CancelJob: failed to encode response: %v", err)
		}
	}
}

// GetJobStats returns statistics about the job queue
func GetJobStats(jobStore JobStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		stats, err := jobStore.GetStats(r.Context())
		if err != nil {
			log.Printf("GetJobStats: failed to get stats: %v", err)
			http.Error(w, "failed to retrieve job statistics", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(stats); err != nil {
			log.Printf("GetJobStats: failed to encode response: %v", err)
		}
	}
}

// ListPendingJobs returns pending jobs
func ListPendingJobs(jobStore JobStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		limitStr := r.URL.Query().Get("limit")
		limit := 100
		if limitStr != "" {
			if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 1000 {
				limit = l
			}
		}

		jobs, err := jobStore.ListPendingJobs(r.Context(), limit)
		if err != nil {
			log.Printf("ListPendingJobs: failed to list jobs: %v", err)
			http.Error(w, "failed to retrieve jobs", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"jobs":  jobs,
			"count": len(jobs),
		}); err != nil {
			log.Printf("ListPendingJobs: failed to encode response: %v", err)
		}
	}
}

// ListProcessingJobs returns currently processing jobs
func ListProcessingJobs(jobStore JobStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		jobs, err := jobStore.ListProcessingJobs(r.Context())
		if err != nil {
			log.Printf("ListProcessingJobs: failed to list jobs: %v", err)
			http.Error(w, "failed to retrieve jobs", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"jobs":  jobs,
			"count": len(jobs),
		}); err != nil {
			log.Printf("ListProcessingJobs: failed to encode response: %v", err)
		}
	}
}

// JobHandler holds dependencies for job handlers
type JobHandler struct {
	Store  *store.JobStore
	Worker *worker.Worker
}

// NewJobHandler creates a new JobHandler instance
func NewJobHandler(store *store.JobStore, worker *worker.Worker) *JobHandler {
	return &JobHandler{
		Store:  store,
		Worker: worker,
	}
}

// RegisterRoutes registers job handlers with the router
func (h *JobHandler) RegisterRoutes(router chi.Router) {
	router.Post("/api/jobs", CreateJob(h.Store))
	router.Get("/api/jobs", GetJob(h.Store))
	router.Post("/api/jobs/{id}/cancel", CancelJob(h.Store))
	router.Get("/api/jobs/stats", GetJobStats(h.Store))
	router.Get("/api/jobs/pending", ListPendingJobs(h.Store))
	router.Get("/api/jobs/processing", ListProcessingJobs(h.Store))
}
