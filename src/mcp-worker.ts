import type { Props } from "./utils";

export type McpEnv = Cloudflare.Env & {
  SESSION_SECRET?: string;
  MCP_SECRET?: string;
  BACKEND_BASE_URL?: string;
  MCP_SERVER_URL?: string;
  LOG_LEVEL?: string;
};

export interface ExtractedSecret {
  secret: string;
  fromDeprecatedQueryParam: boolean;
}

const DEPRECATION_WARNING =
  "[mcp] Deprecation: MCP secret was provided via query parameter. " +
  "Use the X-MCP-Secret header instead. The query-parameter form exposes " +
  "the secret in access logs, browser history, and proxy logs.";

export function extractMcpSecretFromRequest(request: Request): ExtractedSecret | undefined {
  const headerSecret = request.headers.get("x-mcp-secret") || request.headers.get("X-MCP-SECRET");
  if (headerSecret && headerSecret.trim().length > 0) {
    return { secret: headerSecret.trim(), fromDeprecatedQueryParam: false };
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
          return { secret: value, fromDeprecatedQueryParam: false };
        }
      }
    }
  }

  try {
    const url = new URL(request.url);
    // NOTE: Reading the MCP secret from query parameters is supported for
    // backward compatibility with existing MCP client configurations that use
    // URLs like https://example.com/mcp?mcp_secret=ABC123. New configurations
    // should use the X-MCP-Secret header instead. The query parameter path is
    // retained to avoid breaking deployed clients but is deprecated.
    // lgtm[js/sensitive-get-query]
    const directSecret =
      url.searchParams.get("mcp_secret") ||
      url.searchParams.get("MCP_SECRET") ||
      url.searchParams.get("mcpSecret");
    if (directSecret && directSecret.trim().length > 0) {
      console.warn(DEPRECATION_WARNING);
      return { secret: directSecret.trim(), fromDeprecatedQueryParam: true };
    }

    // NOTE: Same backward-compatibility query-parameter path as above — the
    // secret may also be embedded inside a "query" query parameter. This is
    // deprecated for the same reason: use the X-MCP-Secret header instead.
    // lgtm[js/sensitive-get-query]
    const queryParams = url.searchParams.getAll("query");
    for (const qp of queryParams) {
      if (!qp) continue;
      const match = qp.match(/MCP_SECRET=([^&\s]+)/);
      if (match && match[1]) {
        const extracted = match[1].trim();
        if (extracted.length > 0) {
          console.warn(DEPRECATION_WARNING);
          return { secret: extracted, fromDeprecatedQueryParam: true };
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

  const extracted = extractMcpSecretFromRequest(request);
  if (extracted && !headers.has("x-mcp-secret")) {
    headers.set("x-mcp-secret", extracted.secret);
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
  if (extracted?.fromDeprecatedQueryParam) {
    respHeaders.set("Deprecation", "true");
    respHeaders.set(
      "Link",
      '</mcp>; rel="successor-version"',
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: respHeaders,
  });
}
