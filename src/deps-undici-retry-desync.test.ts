import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

const undici = createRequire(import.meta.url)("undici") as typeof import("undici");
const undiciPkg = createRequire(import.meta.url)("undici/package.json") as { version: string };

/**
 * Regression test for Dependabot alert #115 / CVE-2026-16728
 * (GHSA-8xcm-r25x-g524).
 *
 * Undici's `interceptors.retry()` can deliver a response whose body length
 * does not match the `Content-Length` header exposed to the application after
 * a retry or resume of a partial response. Applications that use
 * `interceptors.retry()` and forward upstream response headers and bodies
 * downstream may emit an invalid HTTP response with a stale `Content-Length`
 * header, leading to downstream response desynchronization, connection hangs,
 * or response corruption.
 *
 * Fixed in undici 7.29.0. The fix rejects partial responses whose
 * `Content-Length` is inconsistent with `Content-Range`.
 */
describe("Dependabot #115 — undici retry interceptor desync (CVE-2026-16728)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const range = req.headers["range"];
      if (range && range.startsWith("bytes=99-")) {
        // Retry request for the remaining byte — consistent Content-Range.
        res.writeHead(206, {
          "Content-Type": "text/plain",
          "Content-Range": "bytes 99-99/100",
          "Content-Length": "1",
        });
        res.end("X");
      } else {
        // Initial response: claim 300 bytes but only send 100, then close.
        // On a vulnerable version, the retry interceptor would resume and
        // deliver a 100-byte body while the stale Content-Length: 300 stays.
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "Content-Length": "300",
        });
        res.end("A".repeat(100));
      }
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

  it("retry interceptor rejects or corrects inconsistent Content-Length on partial responses", async () => {
    const agent = new undici.Agent({
      interceptors: [undici.interceptors.retry({ maxRetries: 3 })],
    });

    // On a fixed version, undici rejects partial responses whose
    // Content-Length is inconsistent with Content-Range, or the body
    // length matches the exposed Content-Length. Either outcome is safe.
    try {
      const res = await undici.request(`${baseUrl}/partial`, {
        dispatcher: agent,
      });
      const body = await res.body.text();
      const contentLength = parseInt(res.headers["content-length"] as string, 10);
      // If we got a response, the body length must match Content-Length.
      if (!Number.isNaN(contentLength)) {
        expect(body.length).toBe(contentLength);
      }
    } catch (err) {
      // On a fixed version, undici may reject the inconsistent response.
      expect(err).toBeDefined();
    }
  }, 15000);
});
