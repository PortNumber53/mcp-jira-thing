import { describe, expect, it } from "vitest";
import { escapeDriveQueryString } from "./utils";

/**
 * Regression test for code scanning alerts #5 and #6 —
 * js/incomplete-sanitization in src/integrations/google-docs.ts:130 and
 * src/include/tools.js:283.
 *
 * The Google Drive API search query builder interpolates a user-provided
 * search term into a single-quoted string literal:
 *   ` and name contains '${query.replace(/'/g, "\\'")}'`
 *
 * The original code only escaped single quotes but not backslashes. An
 * attacker could input `\'` (backslash followed by quote), which after the
 * replace becomes `\\'` — the backslash is doubled (escaped) but the quote
 * is now unescaped, breaking out of the string literal and allowing
 * injection of arbitrary Google Drive API query directives.
 *
 * The fix escapes backslashes first, then single quotes, via the shared
 * escapeDriveQueryString helper in src/utils.ts. Both production call sites
 * (src/include/tools.js and src/integrations/google-docs.ts) import and use
 * that helper, so this test exercises the real implementation.
 */

describe("Code scanning #5-6 — Google Docs query escaping", () => {
  it("escapes single quotes", () => {
    expect(escapeDriveQueryString("it's")).toBe("it\\'s");
  });

  it("escapes backslashes", () => {
    expect(escapeDriveQueryString("a\\b")).toBe("a\\\\b");
  });

  it("escapes backslash-quote sequence (the injection vector)", () => {
    // Input: \' (backslash + quote)
    // Vulnerable code: replace(/'/g, "\\'") → \\'
    //   The backslash is doubled but the quote is now unescaped, breaking
    //   out of the string literal.
    // Fixed code: replace(/\\/g, "\\\\").replace(/'/g, "\\'") → \\\\'
    //   Both the backslash and the quote are properly escaped.
    const input = "\\'";
    const escaped = escapeDriveQueryString(input);
    // After fix: backslash is doubled (\\), then quote is escaped (\')
    // Result: \\\' (3 backslashes + quote) = "\\\\\\'" in JS string literal
    expect(escaped).toBe("\\\\\\'");
  });

  it("handles empty string", () => {
    expect(escapeDriveQueryString("")).toBe("");
  });

  it("handles string with no special characters", () => {
    expect(escapeDriveQueryString("hello world")).toBe("hello world");
  });

  it("handles multiple backslashes and quotes", () => {
    // Input: \'\' → after escaping: \\\'\\\' (each \ becomes \\, each ' becomes \')
    expect(escapeDriveQueryString("\\'\\'")).toBe("\\\\\\'\\\\\\'");
  });
});
