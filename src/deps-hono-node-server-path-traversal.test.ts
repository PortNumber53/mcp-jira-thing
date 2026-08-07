import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it, afterAll, beforeAll } from "vitest";

const rootRequire = createRequire(import.meta.url);

function resolvePackageVersion(pkgName: string): string {
  const entry = rootRequire.resolve(pkgName);
  let dir = dirname(entry);
  for (let i = 0; i < 10; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (pkg.name === pkgName) return pkg.version as string;
    } catch {
      // not readable — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not resolve ${pkgName} version from dependency tree`);
}

/**
 * Regression test for Dependabot alert #113 / GHSA-frvp-7c67-39w9.
 *
 * On Windows hosts, an encoded backslash (`%5C`) in the request path decoded
 * to `\`, which the Windows path resolver treated as a separator.
 * `serve-static` then resolved a single URL segment such as
 * `admin\secret.txt` into a nested file under the root and served it,
 * letting an attacker read static files meant to be protected behind
 * prefix-mounted middleware.
 *
 * Fixed in @hono/node-server 2.0.5.  This test guards against an accidental
 * downgrade.
 */
describe("Dependabot #113 — @hono/node-server path traversal (GHSA-frvp-7c67-39w9)", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hono-serve-static-"));
    mkdirSync(join(tmpRoot, "public"));
    mkdirSync(join(tmpRoot, "protected"));
    writeFileSync(join(tmpRoot, "public", "index.html"), "<h1>public</h1>");
    writeFileSync(join(tmpRoot, "protected", "secret.txt"), "top-secret-data");
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("ships @hono/node-server >= 2.0.5 in the root dependency tree", () => {
    const version = resolvePackageVersion("@hono/node-server");
    const parts = version.split(".").map(Number);
    const [major, minor, patch] = parts;

    expect(major).toBeGreaterThanOrEqual(2);
    if (major === 2) {
      expect(minor).toBeGreaterThanOrEqual(0);
      if (minor === 0) {
        expect(patch).toBeGreaterThanOrEqual(5);
      }
    }
  });

  // The vulnerability only manifests on Windows, where `\` is a path
  // separator. On macOS/Linux the encoded backslash is not treated as a
  // separator, so the test would pass trivially regardless of the fix.
  // Guard with a platform check so the behavioral test only runs where it
  // can actually exercise the vulnerability.
  it.skipIf(process.platform !== "win32")(
    "serveStatic does not serve files via encoded backslash path traversal",
    async () => {
      const { Hono } = rootRequire("hono");
      const { serveStatic } = rootRequire("@hono/node-server/serve-static");

      const app = new Hono();

      // Guard the /protected prefix with middleware that blocks all requests.
      app.use("/protected/*", (c) => {
        return c.text("forbidden", 403);
      });

      // Serve static files from the temp root.
      app.use("*", serveStatic({ root: tmpRoot }));

      // Normal access to a protected file should be blocked by middleware.
      const directRes = await app.request("https://example.com/protected/secret.txt");
      expect(directRes.status).toBe(403);

      // Attempt to bypass the middleware using an encoded backslash (%5C).
      // On a vulnerable version, the router treats `/protected%5Csecret.txt`
      // as a single segment (no `/`), so the /protected/* middleware does not
      // run, but the file resolver decodes `%5C` to `\` and serves the file.
      // On a fixed version, the encoded backslash is rejected or normalized.
      const traversalRes = await app.request(
        "https://example.com/protected%5Csecret.txt",
      );
      const body = await traversalRes.text();

      // The secret file must not be served via the traversal path.
      expect(body).not.toContain("top-secret-data");
    },
  );
});
