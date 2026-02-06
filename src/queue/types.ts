/**
 * Job status lifecycle:
 * pending -> processing -> (completed | failed)
 * failed -> pending (on retry)
 */
export type JobStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

/**
 * Priority levels for job processing
 */
export type JobPriority = "low" | "normal" | "high" | "critical";

/**
 * Job definition that can be serialized and stored
 */
export interface Job<T = unknown> {
  id: string;
  type: string;
  payload: T;
  status: JobStatus;
  priority: JobPriority;
  createdAt: string;
  updatedAt: string;
  scheduledFor?: string;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  retryAfter?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Job execution context passed to handlers
 */
export interface JobContext {
  jobId: string;
  jobType: string;
  attempt: number;
  maxAttempts: number;
  startedAt: string;
  log: (message: string, ...args: unknown[]) => void;
  signal?: AbortSignal;
}

/**
 * Result of job execution
 */
export interface JobResult {
  success: boolean;
  result?: unknown;
  error?: string;
  retry?: boolean;
  retryDelayMs?: number;
}

/**
 * Job handler function type
 */
export type JobHandler<T = unknown> = (payload: T, context: JobContext) => Promise<JobResult>;

/**
 * Instrumentation events for monitoring
 */
export interface JobInstrumentationEvents {
  onEnqueue?: (job: Job) => void | Promise<void>;
  onStart?: (job: Job) => void | Promise<void>;
  onComplete?: (job: Job, result: JobResult) => void | Promise<void>;
  onFail?: (job: Job, error: Error) => void | Promise<void>;
  onRetry?: (job: Job, delayMs: number) => void | Promise<void>;
  onCancel?: (job: Job) => void | Promise<void>;
}

/**
 * Queue configuration options
 */
export interface QueueConfig {
  maxConcurrent: number;
  pollIntervalMs: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  retryBackoffMultiplier: number;
  defaultMaxAttempts: number;
  gracefulShutdownTimeoutMs: number;
  jobTimeoutMs: number;
}

/**
 * Queue statistics for monitoring
 */
export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
}

/**
 * Default queue configuration
 */
export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  maxConcurrent: 5,
  pollIntervalMs: 1000,
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 60000,
  retryBackoffMultiplier: 2,
  defaultMaxAttempts: 3,
  gracefulShutdownTimeoutMs: 30000,
  jobTimeoutMs: 300000, // 5 minutes
};

/**
 * Generate a unique job ID
 */
export function generateJobId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Calculate exponential backoff delay
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  multiplier: number
): number {
  const delay = baseDelayMs * Math.pow(multiplier, attempt - 1);
  return Math.min(delay, maxDelayMs);
}

/**
 * Priority weights for sorting (higher = process first)
 */
export const PRIORITY_WEIGHTS: Record<JobPriority, number> = {
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
};
