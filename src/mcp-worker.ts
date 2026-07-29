import type { Props } from "./utils";

export type McpEnv = Cloudflare.Env & {
  SESSION_SECRET?: string;
  MCP_SECRET?: string;
  BACKEND_BASE_URL?: string;
  MCP_SERVER_URL?: string;
  LOG_LEVEL?: string;
};

export function extractMcpSecretFromRequest(request: Request): string | undefined {
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

export { type Props };

export function getMcpServerUrl(env: McpEnv): string | undefined {
  const url = env.MCP_SERVER_URL;
  if (!url) return undefined;
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export async function proxyToMcpServer(
  request: Request,
  env: McpEnv,
): Promise<Response> {
  const mcpServerUrl = getMcpServerUrl(env);
  if (!mcpServerUrl) {
    return new Response(
      JSON.stringify({ error: "MCP_SERVER_URL is not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const url = new URL(request.url);
  const targetUrl = new URL(url.pathname + url.search, mcpServerUrl);

  const headers = new Headers(request.headers);
  headers.set("Host", new URL(mcpServerUrl).host);

  const mcpSecret = extractMcpSecretFromRequest(request);
  if (mcpSecret && !headers.has("x-mcp-secret")) {
    headers.set("x-mcp-secret", mcpSecret);
  }

  const init: RequestInit = {
    method: request.method,
    headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const response = await fetch(targetUrl.toString(), init);

  const respHeaders = new Headers(response.headers);
  respHeaders.delete("transfer-encoding");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: respHeaders,
  });
}
