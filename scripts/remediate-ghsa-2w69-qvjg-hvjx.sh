#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
FRONTEND_DIR="$ROOT_DIR/frontend"

if [[ "$(git -C "$ROOT_DIR" branch --show-current)" != "security/dependabot-59f9fc9719a0" ]]; then
  echo "Run this remediation from security/dependabot-59f9fc9719a0." >&2
  exit 1
fi

echo "Updating the React Router 6 dependency chain to the first release containing @remix-run/router 1.23.2..."
npm install \
  --prefix "$FRONTEND_DIR" \
  --ignore-scripts \
  --save-prefix='^' \
  react-router-dom@6.30.3

node --input-type=module - "$FRONTEND_DIR/package.json" "$FRONTEND_DIR/package-lock.json" <<'NODE'
import { readFileSync } from "node:fs";

const [manifestPath, lockfilePath] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const lockfile = JSON.parse(readFileSync(lockfilePath, "utf8"));
const packages = lockfile.packages;

const expected = new Map([
  ["node_modules/react-router-dom", "6.30.3"],
  ["node_modules/react-router", "6.30.3"],
  ["node_modules/@remix-run/router", "1.23.2"],
]);

if (manifest.dependencies["react-router-dom"] !== "^6.30.3") {
  throw new Error("frontend/package.json does not require react-router-dom ^6.30.3");
}

for (const [packagePath, version] of expected) {
  if (packages[packagePath]?.version !== version) {
    throw new Error(`${packagePath} resolved to ${packages[packagePath]?.version ?? "nothing"}, expected ${version}`);
  }
}

for (const packagePath of ["node_modules/react-router-dom", "node_modules/react-router"]) {
  if (packages[packagePath].dependencies["@remix-run/router"] !== "1.23.2") {
    throw new Error(`${packagePath} does not pin patched @remix-run/router 1.23.2`);
  }
}
NODE

echo "Resolved dependency graph:"
npm ls \
  --prefix "$FRONTEND_DIR" \
  @remix-run/router \
  react-router \
  react-router-dom

AUDIT_REPORT="$(mktemp)"
cleanup() { rm -f "$AUDIT_REPORT"; }
trap cleanup EXIT

# npm audit exits nonzero for unrelated findings, so validate this advisory
# directly while leaving other dependency changes outside this task's scope.
npm audit --prefix "$FRONTEND_DIR" --omit=dev --json > "$AUDIT_REPORT" || true
node --input-type=module - "$AUDIT_REPORT" <<'NODE'
import { readFileSync } from "node:fs";

const report = readFileSync(process.argv[2], "utf8");
if (report.includes("GHSA-2w69-qvjg-hvjx") || report.includes("CVE-2026-22029")) {
  throw new Error("npm audit still reports GHSA-2w69-qvjg-hvjx/CVE-2026-22029");
}
NODE

echo "Running focused frontend validation..."
npm run build --prefix "$FRONTEND_DIR"
