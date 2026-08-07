import type { Request } from "express";

export function extractMcpSecretFromRequest(req: Request): string | undefined {
  const headerSecret = req.headers["x-mcp-secret"] as string | undefined;
  if (headerSecret && headerSecret.trim().length > 0) {
    return headerSecret.trim();
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
          return value;
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
    return directSecret.trim();
  }

  const queryParams = req.query.query;
  if (typeof queryParams === "string") {
    const match = queryParams.match(/MCP_SECRET=([^&\s]+)/);
    if (match && match[1]) {
      const extracted = match[1].trim();
      if (extracted.length > 0) {
        return extracted;
      }
    }
  } else if (Array.isArray(queryParams)) {
    for (const qp of queryParams) {
      if (typeof qp !== "string") continue;
      const match = qp.match(/MCP_SECRET=([^&\s]+)/);
      if (match && match[1]) {
        const extracted = match[1].trim();
        if (extracted.length > 0) {
          return extracted;
        }
      }
    }
  }

  return undefined;
}
