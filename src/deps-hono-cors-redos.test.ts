import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// Resolve hono from the mcp-server directory so we check the version that
// the MCP server actually ships with, not the root worker's copy.
const mcpServerRequire = createRequire(
  require("node:path").join(__dirname, "..", "mcp-server", "index.ts"),
);

function resolveHonoVersion(): string {
  const honoEntry = mcpServerRequire.resolve("hono");
  let dir = dirname(honoEntry);
  for (let i = 0; i < 10; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (pkg.name === "hono") return pkg.version as string;
    } catch {
      // not readable — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not resolve hono version from mcp-server dependency tree");
}

/**
 * Regression test for Dependabot alert #112 / CVE-2026-69207.
 *
 * The built-in CORS middleware (`hono/cors`) parsed the attacker-controlled
 * `Access-Control-Request-Headers` header during a preflight OPTIONS request
 * using a regular expression whose running time was quadratic in the input
 * length.  A single request carrying a long run of whitespace could consume
 * seconds of CPU and stall request processing.
 *
 * Fixed in hono 4.12.34.  This test guards against an accidental downgrade.
 */
describe("Dependabot #112 — hono CORS ReDoS (CVE-2026-69207)", () => {
  it("ships hono >= 4.12.34 in the mcp-server dependency tree", () => {
    const version = resolveHonoVersion();
    const parts = version.split(".").map(Number);
    const [major, minor, patch] = parts;

    expect(major).toBeGreaterThanOrEqual(4);
    if (major === 4) {
      expect(minor).toBeGreaterThanOrEqual(12);
      if (minor === 12) {
        expect(patch).toBeGreaterThanOrEqual(34);
      }
    }
  });

  it("handles a preflight with a long whitespace run in Access-Control-Request-Headers without excessive CPU", async () => {
    const { Hono } = mcpServerRequire("hono");
    const { cors } = mcpServerRequire("hono/cors");

    const app = new Hono();
    app.use("*", cors());
    app.options("*", (c) => c.text("preflight", 204));

    // Craft a header value with a long run of spaces (no delimiter) that
    // triggered quadratic backtracking in the vulnerable regex.
    const maliciousHeaders = "X-Custom".repeat(1) + " ".repeat(20_000);

    const start = Date.now();
    const res = await app.request("https://example.com/api", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": maliciousHeaders,
      },
    });
    const elapsed = Date.now() - start;

    expect(res.status).toBe(204);
    // On a fixed version the response should be near-instant.  A vulnerable
    // version would take several seconds for a 20 000-char whitespace run.
    expect(elapsed).toBeLessThan(2000);
  });
});
