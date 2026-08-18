import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { extractMcpSecretFromRequest } from "./mcp-worker";

function makeRequest(
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, { headers });
}

describe("extractMcpSecretFromRequest", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("extracts the secret from the X-MCP-Secret header", () => {
    const req = makeRequest("https://example.com/mcp", {
      "X-MCP-Secret": "my-secret",
    });
    const result = extractMcpSecretFromRequest(req);
    expect(result?.secret).toBe("my-secret");
    expect(result?.fromDeprecatedQueryParam).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("extracts the secret from the lowercase x-mcp-secret header", () => {
    const req = makeRequest("https://example.com/mcp", {
      "x-mcp-secret": "my-secret",
    });
    const result = extractMcpSecretFromRequest(req);
    expect(result?.secret).toBe("my-secret");
    expect(result?.fromDeprecatedQueryParam).toBe(false);
  });

  it("extracts the secret from the MCP_SECRET cookie", () => {
    const req = makeRequest("https://example.com/mcp", {
      cookie: "MCP_SECRET=cookie-secret",
    });
    const result = extractMcpSecretFromRequest(req);
    expect(result?.secret).toBe("cookie-secret");
    expect(result?.fromDeprecatedQueryParam).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("extracts the secret from the mcp_secret query parameter (deprecated)", () => {
    const req = makeRequest("https://example.com/mcp?mcp_secret=qp-secret");
    const result = extractMcpSecretFromRequest(req);
    expect(result?.secret).toBe("qp-secret");
    expect(result?.fromDeprecatedQueryParam).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("extracts the secret from the MCP_SECRET query parameter (deprecated)", () => {
    const req = makeRequest("https://example.com/mcp?MCP_SECRET=qp-secret");
    const result = extractMcpSecretFromRequest(req);
    expect(result?.secret).toBe("qp-secret");
    expect(result?.fromDeprecatedQueryParam).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("extracts the secret from the mcpSecret query parameter (deprecated)", () => {
    const req = makeRequest("https://example.com/mcp?mcpSecret=qp-secret");
    const result = extractMcpSecretFromRequest(req);
    expect(result?.secret).toBe("qp-secret");
    expect(result?.fromDeprecatedQueryParam).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("extracts the secret from a nested query parameter (deprecated)", () => {
    const req = makeRequest(
      "https://example.com/mcp?query=some_data%26MCP_SECRET%3Dnested-secret",
    );
    const result = extractMcpSecretFromRequest(req);
    expect(result?.secret).toBe("nested-secret");
    expect(result?.fromDeprecatedQueryParam).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("header takes precedence over query parameter", () => {
    const req = makeRequest("https://example.com/mcp?mcp_secret=qp-secret", {
      "X-MCP-Secret": "header-secret",
    });
    const result = extractMcpSecretFromRequest(req);
    expect(result?.secret).toBe("header-secret");
    expect(result?.fromDeprecatedQueryParam).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("header takes precedence over cookie", () => {
    const req = makeRequest("https://example.com/mcp?mcp_secret=qp-secret", {
      "X-MCP-Secret": "header-secret",
      cookie: "MCP_SECRET=cookie-secret",
    });
    const result = extractMcpSecretFromRequest(req);
    expect(result?.secret).toBe("header-secret");
    expect(result?.fromDeprecatedQueryParam).toBe(false);
  });

  it("cookie takes precedence over query parameter", () => {
    const req = makeRequest("https://example.com/mcp?mcp_secret=qp-secret", {
      cookie: "MCP_SECRET=cookie-secret",
    });
    const result = extractMcpSecretFromRequest(req);
    expect(result?.secret).toBe("cookie-secret");
    expect(result?.fromDeprecatedQueryParam).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("query parameter is accepted as fallback when no header or cookie is present", () => {
    const req = makeRequest("https://example.com/mcp?mcp_secret=qp-secret");
    const result = extractMcpSecretFromRequest(req);
    expect(result?.secret).toBe("qp-secret");
    expect(result?.fromDeprecatedQueryParam).toBe(true);
  });

  it("returns undefined when no secret is provided", () => {
    const req = makeRequest("https://example.com/mcp");
    const result = extractMcpSecretFromRequest(req);
    expect(result).toBeUndefined();
  });

  it("trims whitespace from the header secret", () => {
    const req = makeRequest("https://example.com/mcp", {
      "X-MCP-Secret": "  my-secret  ",
    });
    const result = extractMcpSecretFromRequest(req);
    expect(result?.secret).toBe("my-secret");
  });

  it("ignores empty header secret and falls through to query param", () => {
    const req = makeRequest("https://example.com/mcp?mcp_secret=qp-secret", {
      "X-MCP-Secret": "   ",
    });
    const result = extractMcpSecretFromRequest(req);
    expect(result?.secret).toBe("qp-secret");
    expect(result?.fromDeprecatedQueryParam).toBe(true);
  });
});
