// Package worker provides the async job queue processor with queue abstractions,
// worker loop, instrumentation hooks, and graceful shutdown handling.
package worker

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"sync"
	"time"

	"github.com/PortNumber53/mcp-jira-thing/backend/internal/models"
	"github.com/PortNumber53/mcp-jira-thing/backend/internal/store"
)

// Handler is a function that processes a job
type Handler func(ctx context.Context, job *models.Job) error

// Handlers maps job types to their handlers
type Handlers map[string]Handler

// Instrumentation provides hooks for monitoring job lifecycle
type Instrumentation struct {
	OnEnqueue   func(job *models.Job)
	OnStart     func(job *models.Job)
	OnComplete  func(job *models.Job, duration time.Duration)
	OnFail      func(job *models.Job, err error, duration time.Duration)
	OnRetry     func(job *models.Job, retryAfter time.Duration)
	OnCancel    func(job *models.Job)
	OnHeartbeat func(workerID string, stats Stats)
}

// Stats holds worker statistics
type Stats struct {
	JobsProcessed   int64
	JobsSucceeded   int64
	JobsFailed      int64
	JobsRetried     int64
	ActiveWorkers   int
	QueueDepth      int
	LastProcessedAt time.Time
}

// Config holds worker configuration
type Config struct {
	// MaxConcurrent is the maximum number of concurrent job processors
	MaxConcurrent int
	// PollInterval is the time between polling for new jobs
	PollInterval time.Duration
	// RetryBaseDelay is the base delay for exponential backoff
	RetryBaseDelay time.Duration
	// RetryMaxDelay is the maximum delay between retries
	RetryMaxDelay time.Duration
	// RetryBackoffMultiplier is the multiplier for exponential backoff
	RetryBackoffMultiplier float64
	// JobTimeout is the maximum time allowed for a job to run
	JobTimeout time.Duration
	// ShutdownTimeout is the maximum time to wait for jobs to complete during shutdown
	ShutdownTimeout time.Duration
	// HeartbeatInterval is the interval for sending heartbeat metrics
	HeartbeatInterval time.Duration
}

// DefaultConfig returns sensible default configuration
func DefaultConfig() Config {
	return Config{
		MaxConcurrent:          5,
		PollInterval:           time.Second,
		RetryBaseDelay:         time.Second,
		RetryMaxDelay:          time.Minute,
		RetryBackoffMultiplier: 2.0,
		JobTimeout:             5 * time.Minute,
		ShutdownTimeout:        30 * time.Second,
		HeartbeatInterval:      30 * time.Second,
	}
}

// Worker is the async job queue processor
type Worker struct {
	config          Config
	store           *store.JobStore
	handlers        Handlers
	instrumentation *Instrumentation

	workerID string
	wg       sync.WaitGroup
	stopCh   chan struct{}
	stopped  bool
	mu       sync.RWMutex

	// activeJobs tracks currently processing job IDs for graceful shutdown
	activeJobs map[int64]context.CancelFunc

	// stats tracking
	statsMu         sync.RWMutex
	jobsProcessed   int64
	jobsSucceeded   int64
	jobsFailed      int64
	jobsRetried     int64
	lastProcessedAt time.Time
}

// New creates a new Worker instance
func New(config Config, store *store.JobStore, handlers Handlers) *Worker {
	if config.MaxConcurrent <= 0 {
		config.MaxConcurrent = DefaultConfig().MaxConcurrent
	}
	if config.PollInterval <= 0 {
		config.PollInterval = DefaultConfig().PollInterval
	}
	if config.RetryBaseDelay <= 0 {
		config.RetryBaseDelay = DefaultConfig().RetryBaseDelay
	}
	if config.RetryMaxDelay <= 0 {
		config.RetryMaxDelay = DefaultConfig().RetryMaxDelay
	}
	if config.RetryBackoffMultiplier <= 1 {
		config.RetryBackoffMultiplier = DefaultConfig().RetryBackoffMultiplier
	}
	if config.JobTimeout <= 0 {
		config.JobTimeout = DefaultConfig().JobTimeout
	}
	if config.ShutdownTimeout <= 0 {
		config.ShutdownTimeout = DefaultConfig().ShutdownTimeout
	}

	return &Worker{
		config:          config,
		store:           store,
		handlers:        handlers,
		workerID:        generateWorkerID(),
		stopCh:          make(chan struct{}),
		activeJobs:      make(map[int64]context.CancelFunc),
		instrumentation: &Instrumentation{},
	}
}

// SetInstrumentation sets the instrumentation hooks
func (w *Worker) SetInstrumentation(inst *Instrumentation) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.instrumentation = inst
}

// Start begins the worker loop
func (w *Worker) Start(ctx context.Context) {
	log.Printf("[worker] Starting with ID: %s, max concurrent: %d", w.workerID, w.config.MaxConcurrent)

	// Start heartbeat goroutine
	if w.instrumentation.OnHeartbeat != nil {
		w.wg.Add(1)
		go w.heartbeat(ctx)
	}

	// Start worker pool
	for i := 0; i < w.config.MaxConcurrent; i++ {
		w.wg.Add(1)
		go w.processor(ctx, i)
	}

	log.Printf("[worker] Started %d processors", w.config.MaxConcurrent)
}

// Stop gracefully shuts down the worker
func (w *Worker) Stop(ctx context.Context) error {
	log.Printf("[worker] Initiating graceful shutdown...")

	w.mu.Lock()
	if w.stopped {
		w.mu.Unlock()
		return nil
	}
	w.stopped = true
	close(w.stopCh)
	w.mu.Unlock()

	// Create a timeout context for shutdown
	shutdownCtx, cancel := context.WithTimeout(ctx, w.config.ShutdownTimeout)
	defer cancel()

	// Release any active jobs back to pending
	if err := w.releaseActiveJobs(shutdownCtx); err != nil {
		log.Printf("[worker] Error releasing active jobs: %v", err)
	}

	// Wait for all processors to finish
	done := make(chan struct{})
	go func() {
		w.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		log.Printf("[worker] Graceful shutdown completed")
		return nil
	case <-shutdownCtx.Done():
		log.Printf("[worker] Shutdown timeout exceeded, forcing stop")
		return fmt.Errorf("shutdown timeout exceeded")
	}
}

// processor is the main loop for a single worker goroutine
func (w *Worker) processor(ctx context.Context, id int) {
	defer w.wg.Done()

	processorID := fmt.Sprintf("%s-processor-%d", w.workerID, id)
	log.Printf("[worker] Processor %s started", processorID)

	for {
		select {
		case <-ctx.Done():
			log.Printf("[worker] Processor %s shutting down (context cancelled)", processorID)
			return
		case <-w.stopCh:
			log.Printf("[worker] Processor %s shutting down (stop signal)", processorID)
			return
		default:
			if err := w.processNextJob(ctx); err != nil {
				if err != context.Canceled && err != context.DeadlineExceeded {
					log.Printf("[worker] Processor %s error: %v", processorID, err)
				}
			}
		}
	}
}

// processNextJob attempts to claim and process the next available job
func (w *Worker) processNextJob(ctx context.Context) error {
	// Try to claim a job
	job, err := w.store.ClaimNextJob(ctx, w.workerID)
	if err != nil {
		return err
	}
	if job == nil {
		// No jobs available, wait before polling again
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-w.stopCh:
			return nil
		case <-time.After(w.config.PollInterval):
			return nil
		}
	}

	// Process the job
	w.processJob(ctx, job)
	return nil
}

// processJob handles the execution of a single job
func (w *Worker) processJob(ctx context.Context, job *models.Job) {
	start := time.Now()

	// Create a cancellable context for this job
	jobCtx, cancel := context.WithTimeout(ctx, w.config.JobTimeout)
	defer cancel()

	// Track the active job for graceful shutdown
	w.trackActiveJob(job.ID, cancel)
	defer w.untrackActiveJob(job.ID)

	// Instrumentation: job started
	if w.instrumentation.OnStart != nil {
		w.instrumentation.OnStart(job)
	}

	log.Printf("[worker] Processing job %d (type: %s, attempt: %d/%d)",
		job.ID, job.JobType, job.Attempts, job.MaxAttempts)

	// Get the handler for this job type
	handler, ok := w.handlers[job.JobType]
	if !ok {
		w.handleError(jobCtx, job, fmt.Errorf("no handler registered for job type: %s", job.JobType), start)
		return
	}

	// Execute the handler
	err := handler(jobCtx, job)

	if err != nil {
		w.handleError(jobCtx, job, err, start)
	} else {
		w.handleSuccess(jobCtx, job, start)
	}
}

// handleError handles a job failure, retrying if appropriate
func (w *Worker) handleError(ctx context.Context, job *models.Job, err error, start time.Time) {
	duration := time.Since(start)

	log.Printf("[worker] Job %d failed after %v: %v", job.ID, duration, err)

	w.statsMu.Lock()
	w.jobsProcessed++
	w.jobsFailed++
	w.lastProcessedAt = time.Now()
	w.statsMu.Unlock()

	// Instrumentation: job failed
	if w.instrumentation.OnFail != nil {
		w.instrumentation.OnFail(job, err, duration)
	}

	// Check if we should retry
	if job.Attempts < job.MaxAttempts {
		// Calculate retry delay with exponential backoff and jitter
		baseDelay := float64(w.config.RetryBaseDelay) * pow(w.config.RetryBackoffMultiplier, float64(job.Attempts-1))
		maxDelay := float64(w.config.RetryMaxDelay)
		delay := time.Duration(min(baseDelay, maxDelay))
		
		// Add jitter (±20%) to prevent thundering herd
		jitter := time.Duration(float64(delay) * (0.8 + 0.4*rand.Float64()))
		retryAfter := time.Now().Add(jitter)

		w.statsMu.Lock()
		w.jobsRetried++
		w.statsMu.Unlock()

		// Instrumentation: job retry scheduled
		if w.instrumentation.OnRetry != nil {
			w.instrumentation.OnRetry(job, jitter)
		}

		log.Printf("[worker] Scheduling retry for job %d after %v (attempt %d/%d)",
			job.ID, jitter, job.Attempts, job.MaxAttempts)

		if err := w.store.ScheduleRetry(ctx, job.ID, err.Error(), retryAfter); err != nil {
			log.Printf("[worker] Failed to schedule retry for job %d: %v", job.ID, err)
		}
	} else {
		// Max attempts reached, mark as failed
		log.Printf("[worker] Job %d exhausted all %d attempts, marking as failed", job.ID, job.MaxAttempts)
		
		if err := w.store.MarkFailed(ctx, job.ID, err.Error()); err != nil {
			log.Printf("[worker] Failed to mark job %d as failed: %v", job.ID, err)
		}
	}
}

// handleSuccess handles a successful job completion
func (w *Worker) handleSuccess(ctx context.Context, job *models.Job, start time.Time) {
	duration := time.Since(start)

	log.Printf("[worker] Job %d completed successfully in %v", job.ID, duration)

	w.statsMu.Lock()
	w.jobsProcessed++
	w.jobsSucceeded++
	w.lastProcessedAt = time.Now()
	w.statsMu.Unlock()

	// Instrumentation: job completed
	if w.instrumentation.OnComplete != nil {
		w.instrumentation.OnComplete(job, duration)
	}

	if err := w.store.MarkCompleted(ctx, job.ID); err != nil {
		log.Printf("[worker] Failed to mark job %d as completed: %v", job.ID, err)
	}
}

// trackActiveJob adds a job to the active jobs map
func (w *Worker) trackActiveJob(jobID int64, cancel context.CancelFunc) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.activeJobs[jobID] = cancel
}

// untrackActiveJob removes a job from the active jobs map
func (w *Worker) untrackActiveJob(jobID int64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.activeJobs, jobID)
}

// releaseActiveJobs releases all processing jobs back to pending status
func (w *Worker) releaseActiveJobs(ctx context.Context) error {
	w.mu.RLock()
	jobIDs := make([]int64, 0, len(w.activeJobs))
	for id := range w.activeJobs {
		jobIDs = append(jobIDs, id)
	}
	w.mu.RUnlock()

	// Cancel all active job contexts
	w.mu.Lock()
	for _, cancel := range w.activeJobs {
		cancel()
	}
	w.mu.Unlock()

	// Release jobs back to pending
	for _, id := range jobIDs {
		if err := w.store.ReleaseJob(ctx, id); err != nil {
			log.Printf("[worker] Failed to release job %d: %v", id, err)
		} else {
			log.Printf("[worker] Released job %d back to pending", id)
		}
	}

	return nil
}

// heartbeat periodically sends stats updates
func (w *Worker) heartbeat(ctx context.Context) {
	defer w.wg.Done()

	ticker := time.NewTicker(w.config.HeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-w.stopCh:
			return
		case <-ticker.C:
			if w.instrumentation.OnHeartbeat != nil {
				stats := w.getStats()
				w.instrumentation.OnHeartbeat(w.workerID, stats)
			}
		}
	}
}

// getStats returns current worker statistics
func (w *Worker) getStats() Stats {
	w.statsMu.RLock()
	defer w.statsMu.RUnlock()

	w.mu.RLock()
	activeWorkers := len(w.activeJobs)
	w.mu.RUnlock()

	return Stats{
		JobsProcessed:   w.jobsProcessed,
		JobsSucceeded:   w.jobsSucceeded,
		JobsFailed:      w.jobsFailed,
		JobsRetried:     w.jobsRetried,
		ActiveWorkers:   activeWorkers,
		LastProcessedAt: w.lastProcessedAt,
	}
}

// GetStats returns current worker statistics (public)
func (w *Worker) GetStats() Stats {
	return w.getStats()
}

// Enqueue creates a new job in the queue
func (w *Worker) Enqueue(ctx context.Context, job *models.Job) error {
	if err := job.IsValid(); err != nil {
		return err
	}

	if err := w.store.Enqueue(ctx, job); err != nil {
		return err
	}

	// Instrumentation: job enqueued
	if w.instrumentation.OnEnqueue != nil {
		w.instrumentation.OnEnqueue(job)
	}

	log.Printf("[worker] Enqueued job %d (type: %s, priority: %s)", job.ID, job.JobType, job.Priority)
	return nil
}

// CancelJob cancels a pending or failed job
func (w *Worker) CancelJob(ctx context.Context, jobID int64) error {
	if err := w.store.CancelJob(ctx, jobID); err != nil {
		return err
	}

	// Instrumentation: job cancelled
	if w.instrumentation.OnCancel != nil {
		// Fetch job for instrumentation
		job, _ := w.store.GetByID(ctx, jobID)
		if job != nil {
			w.instrumentation.OnCancel(job)
		}
	}

	log.Printf("[worker] Cancelled job %d", jobID)
	return nil
}

// GetQueueStats returns statistics about the job queue
func (w *Worker) GetQueueStats(ctx context.Context) (*models.JobStats, error) {
	return w.store.GetStats(ctx)
}

// Helper functions

func generateWorkerID() string {
	return fmt.Sprintf("worker-%d-%d", time.Now().UnixNano(), rand.Intn(10000))
}

func pow(base, exp float64) float64 {
	result := 1.0
	for i := 0; i < int(exp); i++ {
		result *= base
	}
	return result
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
