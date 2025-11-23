import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { JiraClient } from "./tools/jira";
import { GitHubHandler } from "./github-handler";
import { registerTools } from "./include/tools";
import type { Props } from "./utils";

export type McpEnv = Cloudflare.Env & {
  SESSION_SECRET?: string;
  AI: any;
  MCP_OBJECT: DurableObjectNamespace<MyMCP>;
  MCP_SECRET?: string;
  BACKEND_BASE_URL?: string;
  LOG_LEVEL?: string;
};

type LogLevel = "debug" | "info" | "warn" | "error";
const logLevels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function logMessage(env: any, level: LogLevel, message: string, ...args: any[]) {
  const logLevelStr = (env?.LOG_LEVEL as LogLevel | undefined) || "info";
  const logLevelsOrder: Record<LogLevel, number> = logLevels;
  if (logLevelsOrder[level] >= logLevelsOrder[logLevelStr]) {
    if (level === "error") {
      console.error(`[${level.toUpperCase()}] ${message}`, ...args);
    } else {
      console.log(`[${level.toUpperCase()}] ${message}`, ...args);
    }
  }
}

function extractMcpSecretFromRequest(request: Request): string | undefined {
  const headerSecret = request.headers.get("x-mcp-secret") || request.headers.get("X-MCP-SECRET");
  if (headerSecret && headerSecret.trim().length > 0) {
    return headerSecret.trim();
  }

  const cookieHeader = request.headers.get("cookie") || request.headers.get("Cookie");
  if (cookieHeader) {
    const cookies = cookieHeader.split(";");
    for (const raw of cookies) {
      const [name, ...rest] = raw.split("=");
      if (!name) continue;
      if (name.trim() === "MCP_SECRET") {
        const value = rest.join("=").trim();
        if (value) {
          return value;
        }
      }
    }
  }

  try {
    const url = new URL(request.url);
    const directSecret =
      url.searchParams.get("mcp_secret") ||
      url.searchParams.get("MCP_SECRET") ||
      url.searchParams.get("mcpSecret");
    if (directSecret && directSecret.trim().length > 0) {
      return directSecret.trim();
    }

    const queryParams = url.searchParams.getAll("query");
    for (const qp of queryParams) {
      if (!qp) continue;
      const match = qp.match(/MCP_SECRET=([^&\s]+)/);
      if (match && match[1]) {
        const extracted = match[1].trim();
        if (extracted.length > 0) {
          return extracted;
        }
      }
    }
  } catch {
    // ignore url parse issues
  }

  return undefined;
}

export class MyMCP extends McpAgent<McpEnv, Props> {
  private jiraClient: JiraClient | null = null;

  constructor(state: DurableObjectState, env: McpEnv) {
    super(state, env);
  }

  private async getJiraClient(): Promise<JiraClient> {
    if (this.jiraClient) return this.jiraClient;
    const jiraEnv = await this.buildTenantJiraEnv();
    this.jiraClient = new JiraClient(jiraEnv as any);
    return this.jiraClient;
  }

  server = new McpServer({
    name: "Github OAuth Proxy Demo",
    version: "1.0.0",
  });

  async init() {
    await registerTools.call(this);
  }

  private async buildTenantJiraEnv(): Promise<McpEnv> {
    const baseEnv = this.env as McpEnv;

    const backendBase = baseEnv.BACKEND_BASE_URL;
    const props = (this.props as Props | undefined) ?? undefined;
    let mcpSecret = props?.mcpSecret;

    if (!backendBase) {
      throw new Error("BACKEND_BASE_URL must be configured when using MCP_SECRET for tenant resolution");
    }

    if (!mcpSecret) {
      const userEmail = props?.email?.trim();

      logMessage(this.env, "debug", "No MCP_SECRET on props, attempting to resolve by user email", {
        backendBase,
        userEmail_present: !!userEmail,
      });

      if (!userEmail) {
        throw new Error("MCP_SECRET is required and could not be resolved for the current user (missing email on props)");
      }

      logMessage(this.env, "debug", "Sending request to /api/mcp/secret to resolve MCP secret");
      const secretUrl = new URL("/api/mcp/secret", backendBase);
      secretUrl.searchParams.set("email", userEmail);

      const secretResponse = await fetch(secretUrl.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
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

    logMessage(this.env, "debug", "Sending request to /api/settings/jira/tenant to resolve Jira settings");
    const url = new URL("/api/settings/jira/tenant", backendBase);
    url.searchParams.set("mcp_secret", mcpSecret);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
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
}

const sseHandler = MyMCP.serveSSE("/sse") as any;
const mcpHandler = MyMCP.serve("/mcp") as any;

function withMcpSecret(handler: any): any {
  return {
    async fetch(request: Request, env: McpEnv, ctx: ExecutionContext) {
      const mcpSecret = extractMcpSecretFromRequest(request);
      if (mcpSecret) {
        const existingProps = (ctx as any).props ?? {};
        (ctx as any).props = { ...existingProps, mcpSecret } as Props;
      }

      if (typeof handler === "function") {
        return handler(request, env, ctx);
      }
      if (handler && typeof handler.fetch === "function") {
        return handler.fetch(request, env, ctx);
      }

      return new Response("Not Found", { status: 404 });
    },
  };
}

export function createMcpOAuthProvider() {
  return new OAuthProvider({
    apiHandlers: {
      "/sse": withMcpSecret(sseHandler),
      "/mcp": withMcpSecret(mcpHandler),
    },
    authorizeEndpoint: "/authorize",
    clientRegistrationEndpoint: "/register",
    defaultHandler: GitHubHandler as any,
    tokenEndpoint: "/token",
  });
}
