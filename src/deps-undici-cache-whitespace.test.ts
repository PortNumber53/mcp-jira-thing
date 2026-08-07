import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

const undici = createRequire(import.meta.url)("undici") as typeof import("undici");
const undiciPkg = createRequire(import.meta.url)("undici/package.json") as { version: string };

/**
 * Regression test for Dependabot alert #117 / CVE-2026-14643
 * (GHSA-jr45-8vmc-qm54).
 *
 * Undici's cache interceptor mishandles optional whitespace (OWS) placed
 * around the `=` of a qualified `no-cache` or `private` Cache-Control
 * directive, such as `no-cache ="authorization"` (OWS before `=`) or
 * `no-cache= "authorization"` (OWS after `=`). The parser either drops the
 * directive entirely or stores a field name with literal quote characters,
 * so the downstream cache decisions do not recognize the qualification and
 * the response is stored.
 *
 * In shared-cache mode, this allows a response containing one user's
 * authenticated data to be served from cache to a subsequent caller,
 * including an unauthenticated caller, when both requests resolve to the
 * same cache key.
 *
 * Fixed in undici 7.29.0.
 */
describe("Dependabot #117 — undici Cache-Control whitespace disclosure (CVE-2026-14643)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const cc = req.headers["x-cache-control-override"] as string | undefined;
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Cache-Control": cc || "public, max-age=60",
      });
      res.end(`user:${req.headers["x-user-id"] || "anonymous"}`);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("ships undici >= 7.29.0", () => {
    const parts = undiciPkg.version.split(".").map(Number);
    const [major, minor, patch] = parts;
    expect(major).toBeGreaterThanOrEqual(7);
    if (major === 7) {
      expect(minor).toBeGreaterThanOrEqual(29);
      if (minor === 29) {
        expect(patch).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("does not cache responses with OWS-padded no-cache directives (whitespace before =)", async () => {
    const agent = new undici.Agent({
      interceptors: [undici.interceptors.cache()],
    });

    // First request: user A gets a response with a whitespace-padded
    // no-cache directive that should prevent caching.
    const res1 = await undici.request(`${baseUrl}/ows-before`, {
      dispatcher: agent,
      headers: {
        "X-User-Id": "user-a",
        "X-Cache-Control-Override": 'public, max-age=300, no-cache ="authorization"',
      },
    });
    const body1 = await res1.body.text();
    expect(body1).toBe("user:user-a");

    // Second request: user B should NOT receive user A's cached response.
    const res2 = await undici.request(`${baseUrl}/ows-before`, {
      dispatcher: agent,
      headers: {
        "X-User-Id": "user-b",
        "X-Cache-Control-Override": 'public, max-age=300, no-cache ="authorization"',
      },
    });
    const body2 = await res2.body.text();
    expect(body2).toBe("user:user-b");
  });

  it("does not cache responses with OWS-padded no-cache directives (whitespace after =)", async () => {
    const agent = new undici.Agent({
      interceptors: [undici.interceptors.cache()],
    });

    const res1 = await undici.request(`${baseUrl}/ows-after`, {
      dispatcher: agent,
      headers: {
        "X-User-Id": "user-a",
        "X-Cache-Control-Override": 'public, max-age=300, no-cache= "authorization"',
      },
    });
    const body1 = await res1.body.text();
    expect(body1).toBe("user:user-a");

    const res2 = await undici.request(`${baseUrl}/ows-after`, {
      dispatcher: agent,
      headers: {
        "X-User-Id": "user-b",
        "X-Cache-Control-Override": 'public, max-age=300, no-cache= "authorization"',
      },
    });
    const body2 = await res2.body.text();
    expect(body2).toBe("user:user-b");
  });
});
