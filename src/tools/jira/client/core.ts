interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

type JiraRequestConfig = {
  headers?: HeadersInit;
  rawBody?: BodyInit;
  accept?: string;
  retry?: RetryOptions;
};

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 200,
  maxDelayMs: 2000,
};

export class JiraClientCore {
  protected apiKey: string;
  protected baseUrl: string;
  protected email: string;

  constructor(env: Env) {
    this.apiKey = env.ATLASSIAN_API_KEY;
    this.baseUrl = env.JIRA_BASE_URL;
    this.email = env.JIRA_EMAIL;

    if (!this.apiKey) {
      throw new Error("ATLASSIAN_API_KEY environment variable is not set.");
    }
    if (!this.baseUrl) {
      throw new Error("JIRA_BASE_URL environment variable is not set.");
    }
    if (!this.email) {
      throw new Error("JIRA_EMAIL environment variable is not set.");
    }
  }

  protected async makeRequest<T>(endpoint: string, method: string = "GET", data?: any, config: JiraRequestConfig = {}): Promise<T> {
    const auth = `Basic ${btoa(`${this.email}:${this.apiKey}`)}`;

    const headers = new Headers(config.headers);
    headers.set("Authorization", auth);
    headers.set("Accept", config.accept || headers.get("Accept") || "application/json");

    const retryOptions = {
      ...DEFAULT_RETRY_OPTIONS,
      ...config.retry,
    } as Required<RetryOptions>;

    const jsonPayload = config.rawBody === undefined && data !== undefined ? JSON.stringify(data) : undefined;
    if (jsonPayload !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= Math.max(1, retryOptions.maxAttempts); attempt += 1) {
      const requestOptions: RequestInit = {
        method,
        headers,
      };

      if (config.rawBody !== undefined) {
        requestOptions.body = config.rawBody;
      } else if (jsonPayload !== undefined) {
        requestOptions.body = jsonPayload;
      }

      try {
        const response = await fetch(`${this.baseUrl}${endpoint}`, requestOptions);

        if (!response.ok) {
          const retryAfter = response.headers.get("Retry-After");
          if (shouldRetry(response.status) && attempt < retryOptions.maxAttempts) {
            const delay = calculateBackoffDelay(attempt, retryOptions, retryAfter);
            await sleep(delay);
            continue;
          }

          const errorText = await safeReadResponse(response);
          throw new Error(`Jira API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        if (response.status === 204) {
          return {} as T;
        }

        return await response.json();
      } catch (error) {
        lastError = error;

        if (attempt >= retryOptions.maxAttempts || !isRetryableError(error)) {
          console.error(`Error making ${method} request to ${endpoint}:`, error);
          throw error;
        }

        const delay = calculateBackoffDelay(attempt, retryOptions);
        await sleep(delay);
      }
    }

    console.error(`Error making ${method} request to ${endpoint}:`, lastError);
    throw lastError instanceof Error ? lastError : new Error("Unable to complete Jira request");
  }
}

function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Some environments wrap network failures in TypeError or FetchError.
    return error.name === "TypeError" || error.name === "FetchError";
  }
  return false;
}

function calculateBackoffDelay(attempt: number, options: Required<RetryOptions>, retryAfterHeader?: string | null): number {
  const baseDelay = Math.min(options.initialDelayMs * 2 ** (attempt - 1), options.maxDelayMs);
  const jitter = baseDelay * 0.25;
  let delay = baseDelay + Math.random() * jitter;

  const retryAfter = parseRetryAfter(retryAfterHeader ?? null);
  if (retryAfter !== null) {
    delay = Math.max(delay, retryAfter);
  }

  return Math.min(delay, options.maxDelayMs);
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) {
    return null;
  }

  const seconds = Number(header);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return null;
}

async function safeReadResponse(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    console.warn("Failed to read response text", error);
    return "<no response body>";
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
