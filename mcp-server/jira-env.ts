export type Props = {
  login: string;
  name: string;
  email: string;
  accessToken: string;
  mcpSecret?: string;
};

export type McpEnv = {
  BACKEND_BASE_URL?: string;
  LOG_LEVEL?: string;
  JIRA_BASE_URL?: string;
  JIRA_EMAIL?: string;
  ATLASSIAN_API_KEY?: string;
  SLACK_BOT_TOKEN?: string;
  INTEGRATION_SLACK_ENABLED?: string;
  INTEGRATION_GOOGLE_DOCS_ENABLED?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AI?: any;
  [key: string]: unknown;
};

const BACKEND_TIMEOUT_MS = 10_000;

type LogLevel = "debug" | "info" | "warn" | "error";
const logLevels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function logMessage(env: McpEnv, level: LogLevel, message: string, ...args: any[]) {
  const logLevelStr = (env.LOG_LEVEL as LogLevel | undefined) || "info";
  if (logLevels[level] >= logLevels[logLevelStr]) {
    if (level === "error") {
      console.error(`[${level.toUpperCase()}] ${message}`, ...args);
    } else {
      console.log(`[${level.toUpperCase()}] ${message}`, ...args);
    }
  }
}

export async function buildTenantJiraEnv(
  baseEnv: McpEnv,
  props: Props | undefined,
): Promise<McpEnv> {
  const backendBase = baseEnv.BACKEND_BASE_URL;
  let mcpSecret = props?.mcpSecret;

  if (!backendBase) {
    throw new Error("BACKEND_BASE_URL must be configured when using MCP_SECRET for tenant resolution");
  }

  if (!mcpSecret) {
    const userEmail = props?.email?.trim();

    logMessage(baseEnv, "debug", "No MCP_SECRET on props, attempting to resolve by user email", {
      backendBase,
      userEmail_present: !!userEmail,
    });

    if (!userEmail) {
      throw new Error("MCP_SECRET is required and could not be resolved for the current user (missing email on props)");
    }

    logMessage(baseEnv, "debug", "Sending request to /api/mcp/secret to resolve MCP secret");
    const secretUrl = new URL("/api/mcp/secret", backendBase);
    secretUrl.searchParams.set("email", userEmail);

    let secretResponse: Response;
    try {
      secretResponse = await fetch(secretUrl.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
      });
    } catch (err: any) {
      if (err.name === "TimeoutError") {
        throw new Error(`[mcp] Timed out resolving MCP secret after ${BACKEND_TIMEOUT_MS}ms`);
      }
      throw err;
    }
    if (!secretResponse.ok) {
      throw new Error(
        `[mcp] Failed to resolve MCP secret by email: ${secretResponse.status} ${secretResponse.statusText}`,
      );
    }
    const secretData = (await secretResponse.json()) as { mcp_secret?: string | null };
    const resolvedSecret = secretData.mcp_secret ?? undefined;
    if (!resolvedSecret) {
      throw new Error("[mcp] No MCP secret configured for current user");
    }

    mcpSecret = resolvedSecret;
    if (props) (props as Props).mcpSecret = resolvedSecret;
  }

  logMessage(baseEnv, "debug", "Sending request to /api/settings/jira/tenant to resolve Jira settings");
  const url = new URL("/api/settings/jira/tenant", backendBase);
  url.searchParams.set("mcp_secret", mcpSecret);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
  } catch (err: any) {
    if (err.name === "TimeoutError") {
      throw new Error(`[mcp] Timed out resolving Jira settings after ${BACKEND_TIMEOUT_MS}ms`);
    }
    throw err;
  }
  if (!response.ok) {
    throw new Error(
      `[mcp] Failed to resolve Jira settings by MCP secret: ${response.status} ${response.statusText}`,
    );
  }
  const data = (await response.json()) as {
    jira_base_url?: string;
    jira_email?: string;
    atlassian_api_key?: string;
  };

  if (!data.jira_base_url || !data.jira_email || !data.atlassian_api_key) {
    throw new Error("[mcp] Incomplete Jira settings resolved by MCP secret");
  }

  return {
    ...baseEnv,
    JIRA_BASE_URL: data.jira_base_url,
    JIRA_EMAIL: data.jira_email,
    ATLASSIAN_API_KEY: data.atlassian_api_key,
  } as McpEnv;
}
