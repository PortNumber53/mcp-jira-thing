import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { JiraClient } from "./tools/jira";
import { GitHubHandler } from "./github-handler";
import { registerTools } from "./include/tools";
import type { Props } from "./utils";

type Env = Cloudflare.Env & {
  // Optional session secret (legacy compatibility handled elsewhere)
  SESSION_SECRET?: string;
  // Additional bindings used by this Worker
  AI: any;
  MCP_OBJECT: DurableObjectNamespace<MyMCP>;
  // Optional per-tenant MCP secret extracted from the incoming request
  MCP_SECRET?: string;
  // Base URL of the Go backend used to resolve Jira settings per tenant
  BACKEND_BASE_URL?: string;
};

function extractMcpSecretFromRequest(request: Request): string | undefined {
  console.log("[mcp] extractMcpSecretFromRequest function called");
  // Debug logging to understand how MCP_SECRET is being passed through.
  try {
    const rawHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      rawHeaders[key.toLowerCase()] = value;
    });
    // Log the full header map so we can see exactly what is being sent.
    console.log("[mcp] Incoming request headers (raw):", rawHeaders);

    // Also log all query string parameters for additional debugging context.
    try {
      const url = new URL(request.url);
      const queryParams: Record<string, string[]> = {};
      url.searchParams.forEach((value, key) => {
        if (!queryParams[key]) {
          queryParams[key] = [];
        }
        queryParams[key].push(value);
      });
      console.log("[mcp] Incoming request query params:", queryParams);
    } catch (urlErr) {
      console.warn("[mcp] Failed to parse URL/query parameters for MCP secret extraction:", urlErr);
    }
  } catch (err) {
    console.warn("[mcp] Failed to log incoming headers for MCP secret extraction:", err);
  }

  // 1) Prefer explicit header
  const headerSecret = request.headers.get("x-mcp-secret") || request.headers.get("X-MCP-SECRET");
  if (headerSecret && headerSecret.trim().length > 0) {
    console.log("[mcp] MCP secret found in X-MCP-SECRET header (length only):", headerSecret.trim().length);
    return headerSecret.trim();
  }

  // 2) Fall back to Cookie header (e.g. MCP_COOKIE="MCP_SECRET=..." in the MCP client)
  const cookieHeader = request.headers.get("cookie") || request.headers.get("Cookie");
  if (cookieHeader) {
    const cookies = cookieHeader.split(";");
    for (const raw of cookies) {
      const [name, ...rest] = raw.split("=");
      if (!name) continue;
      if (name.trim() === "MCP_SECRET") {
        const value = rest.join("=").trim();
        if (value) {
          console.log("[mcp] MCP secret found in Cookie header (length only):", value.length);
          return value;
        }
      }
    }
  }

  // 3) Finally, attempt to resolve MCP_SECRET from the query string. This supports
  // both a direct ?mcp_secret=... parameter and the Cursor-style
  // ?query=MCP_SECRET=... pattern.
  try {
    const url = new URL(request.url);

    // Direct parameter
    const directSecret = url.searchParams.get("mcp_secret") || url.searchParams.get("MCP_SECRET") || url.searchParams.get("mcpSecret");
    if (directSecret && directSecret.trim().length > 0) {
      console.log("[mcp] MCP secret found in query parameter (direct) (length only):", directSecret.trim().length);
      return directSecret.trim();
    }

    // Fallback: inspect generic "query" parameters for a "MCP_SECRET=..." token
    const queryParams = url.searchParams.getAll("query");
    for (const qp of queryParams) {
      if (!qp) continue;
      const match = qp.match(/MCP_SECRET=([^&\s]+)/);
      if (match && match[1]) {
        const extracted = match[1].trim();
        if (extracted.length > 0) {
          console.log("[mcp] MCP secret extracted from query parameter value (MCP_SECRET=...) (length only):", extracted.length);
          return extracted;
        }
      }
    }
  } catch (err) {
    console.warn("[mcp] Failed to inspect query string for MCP_SECRET:", err);
  }

  return undefined;
}

function extractFirstAppLocation(error: unknown): string | undefined {
  const stack = (error as any)?.stack;
  if (typeof stack !== "string" || stack.length === 0) return undefined;
  try {
    const lines = stack.split("\n");
    // Prefer frames from our project under /src/
    const candidate = lines.find((l) => l.includes("/src/")) || lines[1] || lines[0];
    if (!candidate) return undefined;
    // Extract file:line:column from stack frame
    const match = candidate.match(/(\/[^\s)]+:\d+:\d+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

export class MyMCP extends McpAgent<Env, Props> {
  private jiraClient: JiraClient | null = null;

  constructor(state: DurableObjectState, env: Env) {
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

  private async buildTenantJiraEnv(): Promise<Env> {
    const baseEnv = this.env as Env;

    const backendBase = baseEnv.BACKEND_BASE_URL;
    const props = (this.props as Props | undefined) ?? undefined;
    let mcpSecret = props?.mcpSecret;

    if (!backendBase) {
      throw new Error("BACKEND_BASE_URL must be configured when using MCP_SECRET for tenant resolution");
    }

    // Prefer an explicit MCP secret from the request (header/cookie) or
    // previously cached on this.props. If it's not present, attempt to
    // resolve it from the backend using the authenticated user's email.
    if (!mcpSecret) {
      const userEmail = props?.email?.trim();

      console.log("[mcp] No MCP_SECRET on props, attempting to resolve by user email", {
        backendBase,
        userEmail_present: !!userEmail,
      });

      if (!userEmail) {
        throw new Error("MCP_SECRET is required and could not be resolved for the current user (missing email on props)");
      }

      try {
        console.log("[backend] Sending request to /api/mcp/secret to resolve MCP secret");
        const secretUrl = new URL("/api/mcp/secret", backendBase);
        secretUrl.searchParams.set("email", userEmail);

        const secretResponse = await fetch(secretUrl.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });
        if (!secretResponse.ok) {
          console.log("[backend] Failed to resolve MCP secret: status " + secretResponse.status);
          throw new Error(`[mcp] Failed to resolve MCP secret by email: ${secretResponse.status} ${secretResponse.statusText}`);
        }
        console.log("[backend] Successfully resolved MCP secret");
        const secretData = (await secretResponse.json()) as { mcp_secret?: string | null };
        const resolvedSecret = secretData.mcp_secret ?? undefined;

        if (!resolvedSecret) {
          throw new Error("[mcp] No MCP secret configured for current user");
        }

        mcpSecret = resolvedSecret;

        // Cache for subsequent calls during this DO's lifetime on props only.
        if (props) (props as Props).mcpSecret = resolvedSecret;
      } catch (error) {
        console.error("[backend] Error resolving MCP secret by email:", error);
        throw error instanceof Error ? error : new Error("Failed to resolve MCP secret for current user");
      }
    }

    // At this point we must have an MCP secret, whether supplied by the
    // client or resolved from the backend.
    if (!mcpSecret) {
      throw new Error("MCP_SECRET is required to resolve tenant Jira settings");
    }

    try {
      console.log("[backend] Sending request to /api/settings/jira/tenant to resolve Jira settings");
      const url = new URL("/api/settings/jira/tenant", backendBase);
      url.searchParams.set("mcp_secret", mcpSecret);

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        console.log("[backend] Failed to resolve Jira settings: status " + response.status);
        throw new Error(`[mcp] Failed to resolve Jira settings by MCP secret: ${response.status} ${response.statusText}`);
      }
      console.log("[backend] Successfully resolved Jira settings");
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
      } as Env;
    } catch (error) {
      console.error("[backend] Error resolving Jira settings by MCP secret:", error);
      throw error instanceof Error ? error : new Error("Failed to resolve Jira settings by MCP secret");
    }
  }
}

const sseHandler = MyMCP.serveSSE("/sse") as any;
const mcpHandler = MyMCP.serve("/mcp") as any;

function withMcpSecret(handler: any): any {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      // Log environment variable keys (and selected values) to understand
      // what the Worker sees at runtime for MCP debugging.
      try {
        const envObj = env as any;
        const envKeys = Object.keys(envObj ?? {});
        console.log("[mcp] Env keys:", envKeys);
        console.log("[mcp] Env snapshot (selected):", {
          BACKEND_BASE_URL: envObj?.BACKEND_BASE_URL,
          GITHUB_CLIENT_ID_present: !!envObj?.GITHUB_CLIENT_ID,
          SESSION_SECRET_present: !!envObj?.SESSION_SECRET,
        });
      } catch (err) {
        console.warn("[mcp] Failed to log env bindings:", err);
      }

      // Extra debugging for SSE message traffic
      try {
        const url = new URL(request.url);
        if (url.pathname.endsWith("/sse/message")) {
          const contentType = request.headers.get("content-type") || "";
          let bodyPreview: unknown = "[unread]";
          try {
            if (contentType.includes("application/json")) {
              const clone = request.clone();
              const json = await clone.json();
              // Avoid logging full payload; just structure + keys
              bodyPreview = {
                type: "json",
                keys: typeof json === "object" && json !== null ? Object.keys(json as any) : [],
              };
            } else if (contentType.includes("text/")) {
              const clone = request.clone();
              const text = await clone.text();
              bodyPreview = {
                type: "text",
                length: text.length,
                snippet: text.slice(0, 200),
              };
            } else if (request.headers.get("content-length")) {
              bodyPreview = {
                type: "binary",
                length: Number.parseInt(request.headers.get("content-length") || "0", 10),
              };
            }
          } catch (bodyErr) {
            bodyPreview = { error: String(bodyErr) };
          }

          console.log("[mcp] /sse/message request", {
            method: request.method,
            url: url.toString(),
            headers: {
              // Only log non-sensitive headers
              "content-type": contentType,
              "content-length": request.headers.get("content-length") || null,
              "user-agent": request.headers.get("user-agent") || null,
            },
            bodyPreview,
          });
        }
      } catch (e) {
        console.warn("[mcp] Failed to log /sse/message debug info:", e);
      }

      const mcpSecret = extractMcpSecretFromRequest(request);
      if (mcpSecret) {
        // Attach to ctx.props so the Durable Object-based McpAgent
        // can see the secret via this.props. The agents library passes
        // ctx.props into doStub._init(ctx.props), which becomes
        // MyMCP.props. We merge with any existing props set by the
        // OAuthProvider (login, email, etc.).
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

export default new OAuthProvider({
  apiHandlers: {
    "/sse": withMcpSecret(sseHandler),
    "/mcp": withMcpSecret(mcpHandler),
  },
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: GitHubHandler as any,
  tokenEndpoint: "/token",
});
