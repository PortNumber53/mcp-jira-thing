import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const undici = createRequire(import.meta.url)("undici") as typeof import("undici");
const undiciPkg = createRequire(import.meta.url)("undici/package.json") as { version: string };

/**
 * Regression test for Dependabot alert #116 / CVE-2026-16729
 * (GHSA-v3r7-h72x-cjcm).
 *
 * Undici's `setCookie` function has two attribute injection paths:
 *
 * 1. `validateCookieDomain` does not reject semicolons, so a `domain` value
 *    like `example.com; SameSite=None` lands verbatim as
 *    `Domain=example.com; SameSite=None`.
 * 2. The `unparsed` array's loop only checks each entry contains `=` and does
 *    not sanitize values, so an entry like `X-Custom=val; HttpOnly` lands
 *    unchanged, injecting `HttpOnly` without the caller setting
 *    `cookie.httpOnly = true`.
 *
 * Fixed in undici 7.29.0: `validateCookieDomain` now enforces RFC 1034
 * letter-digit-hyphen syntax (rejecting semicolons), and `unparsed` entries
 * are validated via `validateCookieValue` (which rejects semicolons).
 */
describe("Dependabot #116 — undici cookie attribute injection (CVE-2026-16729)", () => {
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

  it("setCookie rejects domain values containing semicolons (attribute injection via domain)", () => {
    const headers = new Headers();

    // On a vulnerable version, the semicolon in the domain would be
    // serialized verbatim, injecting "SameSite=None" into the Set-Cookie.
    // On a fixed version, validateCookieDomain enforces RFC 1034 syntax
    // and rejects the semicolon.
    expect(() => {
      undici.setCookie(headers, {
        name: "session",
        value: "abc123",
        domain: "example.com; SameSite=None",
      } as any);
    }).toThrow(/Invalid cookie domain/);

    // No cookie should have been appended.
    expect(headers.getSetCookie()).toHaveLength(0);
  });

  it("setCookie rejects unparsed entries containing semicolons (attribute injection via unparsed)", () => {
    const headers = new Headers();

    // On a vulnerable version, the semicolon in the unparsed entry would
    // be serialized verbatim, injecting "HttpOnly" into the Set-Cookie.
    // On a fixed version, validateCookieValue rejects the semicolon.
    expect(() => {
      undici.setCookie(headers, {
        name: "session",
        value: "abc123",
        unparsed: ["X-Custom=val; HttpOnly"],
      } as any);
    }).toThrow(/Invalid cookie/);

    // No cookie should have been appended.
    expect(headers.getSetCookie()).toHaveLength(0);
  });
});
