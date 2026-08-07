import type { Request } from "express";

export interface ExtractedSecret {
  secret: string;
  fromDeprecatedQueryParam: boolean;
}

const DEPRECATION_WARNING =
  "[mcp] Deprecation: MCP secret was provided via query parameter. " +
  "Use the X-MCP-Secret header instead. The query-parameter form exposes " +
  "the secret in access logs, browser history, and proxy logs.";

export function extractMcpSecretFromRequest(req: Request): ExtractedSecret | undefined {
  const headerSecret = req.headers["x-mcp-secret"] as string | undefined;
  if (headerSecret && headerSecret.trim().length > 0) {
    return { secret: headerSecret.trim(), fromDeprecatedQueryParam: false };
  }

  const cookieHeader = req.headers.cookie;
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

  // NOTE: Reading the MCP secret from query parameters is supported for
  // backward compatibility with existing MCP client configurations that use
  // URLs like https://example.com/mcp?mcp_secret=ABC123. New configurations
  // should use the X-MCP-Secret header instead. The query parameter path is
  // retained to avoid breaking deployed clients but is deprecated.
  // lgtm[js/sensitive-get-query]
  const directSecret =
    (req.query.mcp_secret as string) ||
    (req.query.MCP_SECRET as string) ||
    (req.query.mcpSecret as string);
  if (directSecret && directSecret.trim().length > 0) {
    console.warn(DEPRECATION_WARNING);
    return { secret: directSecret.trim(), fromDeprecatedQueryParam: true };
  }

  // NOTE: Same backward-compatibility query-parameter path as above — the
  // secret may also be embedded inside a "query" query parameter. This is
  // deprecated for the same reason: use the X-MCP-Secret header instead.
  // lgtm[js/sensitive-get-query]
  const queryParams = req.query.query;
  if (typeof queryParams === "string") {
    const match = queryParams.match(/MCP_SECRET=([^&\s]+)/);
    if (match && match[1]) {
      const extracted = match[1].trim();
      if (extracted.length > 0) {
        console.warn(DEPRECATION_WARNING);
        return { secret: extracted, fromDeprecatedQueryParam: true };
      }
    }
  } else if (Array.isArray(queryParams)) {
    for (const qp of queryParams) {
      if (typeof qp !== "string") continue;
      const match = qp.match(/MCP_SECRET=([^&\s]+)/);
      if (match && match[1]) {
        const extracted = match[1].trim();
        if (extracted.length > 0) {
          console.warn(DEPRECATION_WARNING);
          return { secret: extracted, fromDeprecatedQueryParam: true };
        }
      }
    }
  }

  return undefined;
}
