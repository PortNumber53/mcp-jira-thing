import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

const undici = createRequire(import.meta.url)("undici") as typeof import("undici");
const undiciPkg = createRequire(import.meta.url)("undici/package.json") as { version: string };

/**
 * Regression test for Dependabot alert #118 / CVE-2026-15157
 * (GHSA-m8rv-5g2x-5cg5).
 *
 * When an application passes a duck-typed blob-like body to undici's HTTP/1.1
 * dispatcher (via `request()`, `stream()`, `pipeline()`, or `dispatch()`)
 * with a `.type` derived from untrusted input, an attacker can inject CRLF
 * sequences (`\r\n`) to append arbitrary HTTP headers and potentially smuggle
 * a second request past the upstream.
 *
 * The vulnerable branch in `lib/dispatcher/client-h1.js` pushes `body.type`
 * directly into the outgoing headers with no validation, while every other
 * header path in undici goes through `isValidHeaderValue()`.
 *
 * Fixed in undici 7.29.0 by adding `isValidHeaderValue()` on this sink.
 */
describe("Dependabot #118 — undici CRLF injection via blob-like body type (CVE-2026-15157)", () => {
  let server: Server;
  let baseUrl: string;
  let lastReceivedHeaders: Record<string, string | string[] | undefined>;

  beforeAll(async () => {
    server = createServer((req, res) => {
      lastReceivedHeaders = { ...req.headers };
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
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

  it("rejects CRLF in blob-like body .type property (header injection prevention)", async () => {
    // Create a duck-typed blob-like body with a malicious .type containing
    // CRLF sequences that would inject an extra header on a vulnerable version.
    const maliciousBody = {
      type: "text/plain\r\nX-Injected: evil",
      size: 5,
      arrayBuffer: async () => new ArrayBuffer(5),
      slice: () => maliciousBody,
    };

    // On a fixed version, undici validates the .type value via
    // isValidHeaderValue() and either rejects the request or strips the
    // CRLF sequence. On a vulnerable version, the server would see
    // "x-injected: evil" in the received headers.
    try {
      await undici.request(`${baseUrl}/test`, {
        method: "POST",
        body: maliciousBody as any,
      });
    } catch (err) {
      // On a fixed version, undici may reject the invalid header value.
      expect(err).toBeDefined();
    }

    // If the request went through, verify no injected header was received.
    if (lastReceivedHeaders) {
      expect(lastReceivedHeaders["x-injected"]).toBeUndefined();
    }
  });
});
