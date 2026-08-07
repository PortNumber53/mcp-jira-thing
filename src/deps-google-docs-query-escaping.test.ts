import { describe, expect, it } from "vitest";

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
 * The fix escapes backslashes first, then single quotes:
 *   query.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
 */

/**
 * Replicates the escaping logic from src/include/tools.js and
 * src/integrations/google-docs.ts to test it in isolation.
 */
function escapeDriveQuery(query: string): string {
  return query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

describe("Code scanning #5-6 — Google Docs query escaping", () => {
  it("escapes single quotes", () => {
    expect(escapeDriveQuery("it's")).toBe("it\\'s");
  });

  it("escapes backslashes", () => {
    expect(escapeDriveQuery("a\\b")).toBe("a\\\\b");
  });

  it("escapes backslash-quote sequence (the injection vector)", () => {
    // Input: \' (backslash + quote)
    // Vulnerable code: replace(/'/g, "\\'") → \\'
    //   The backslash is doubled but the quote is now unescaped, breaking
    //   out of the string literal.
    // Fixed code: replace(/\\/g, "\\\\").replace(/'/g, "\\'") → \\\\'
    //   Both the backslash and the quote are properly escaped.
    const input = "\\'";
    const escaped = escapeDriveQuery(input);
    // After fix: backslash is doubled (\\), then quote is escaped (\')
    // Result: \\\' (3 backslashes + quote) = "\\\\\\'" in JS string literal
    expect(escaped).toBe("\\\\\\'");
    // Verify no unescaped single quote remains: every quote must be
    // preceded by a backslash that is itself part of the escape sequence
    // (not a doubled backslash). The simplest check: the escaped string
    // should not end with an unescaped quote, and should not contain
    // a quote that is not preceded by an odd number of backslashes.
    expect(escaped).not.toMatch(/(?<!\\)(?<!\\\\)'/);
  });

  it("handles empty string", () => {
    expect(escapeDriveQuery("")).toBe("");
  });

  it("handles string with no special characters", () => {
    expect(escapeDriveQuery("hello world")).toBe("hello world");
  });

  it("handles multiple backslashes and quotes", () => {
    // Input: \'\' → after escaping: \\\'\\\' (each \ becomes \\, each ' becomes \')
    expect(escapeDriveQuery("\\'\\'")).toBe("\\\\\\'\\\\\\'");
  });
});
