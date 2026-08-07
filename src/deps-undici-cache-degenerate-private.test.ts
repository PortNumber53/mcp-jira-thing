import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

const undici = createRequire(import.meta.url)("undici") as typeof import("undici");
const undiciPkg = createRequire(import.meta.url)("undici/package.json") as { version: string };

/**
 * Regression test for Dependabot alert #114 / CVE-2026-13697
 * (GHSA-4cwx-7wf7-3272).
 *
 * Two issues in undici's cache interceptor, both fixed in 7.29.0:
 *
 * 1. Shared-cache disclosure: Responses with malformed qualified
 *    `Cache-Control: private` directives such as `private=""` or
 *    `private=","` can be incorrectly stored in the default shared cache,
 *    then served to a later caller with the same cache key.
 * 2. Parse-time crash: Mixed unqualified-and-qualified `private` directives
 *    in the same header (e.g. `public, max-age=60, private, private="hdr"`)
 *    cause an uncaught `TypeError` in the cache-control parser.
 */
describe("Dependabot #114 — undici degenerate private cache directives (CVE-2026-13697)", () => {
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

  it("does not crash when parsing mixed unqualified-and-qualified private directives", async () => {
    const agent = new undici.Agent({
      interceptors: [undici.interceptors.cache()],
    });

    // On a vulnerable version this throws:
    //   TypeError: output.private.concat is not a function
    const res = await undici.request(`${baseUrl}/test`, {
      dispatcher: agent,
      headers: {
        "X-Cache-Control-Override": 'public, max-age=60, private, private="hdr"',
      },
    });
    expect(res.statusCode).toBe(200);
    await res.body.text();
  });

  it('does not store responses with degenerate private="" in shared cache', async () => {
    const agent = new undici.Agent({
      interceptors: [undici.interceptors.cache()],
    });

    // First request: user A gets a response with private="" which should NOT
    // be cached in shared mode.
    const res1 = await undici.request(`${baseUrl}/private-test`, {
      dispatcher: agent,
      headers: {
        "X-User-Id": "user-a",
        "X-Cache-Control-Override": 'public, max-age=300, private=""',
      },
    });
    const body1 = await res1.body.text();
    expect(body1).toBe("user:user-a");

    // Second request: user B should NOT receive user A's cached response.
    const res2 = await undici.request(`${baseUrl}/private-test`, {
      dispatcher: agent,
      headers: {
        "X-User-Id": "user-b",
        "X-Cache-Control-Override": 'public, max-age=300, private=""',
      },
    });
    const body2 = await res2.body.text();
    expect(body2).toBe("user:user-b");
  });
});
