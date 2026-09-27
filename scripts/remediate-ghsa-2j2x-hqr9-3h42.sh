#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
frontend_dir="$repo_root/frontend"

if [[ "$(git -C "$repo_root" branch --show-current)" != "security/dependabot-02d666cbb6b7" ]]; then
  echo "Run this remediation from security/dependabot-02d666cbb6b7." >&2
  exit 1
fi

cd "$frontend_dir"

# react-router-dom 6.30.4 is the first 6.x release whose exact transitive
# dependency is the patched @remix-run/router 1.23.3.
npm install \
  --package-lock-only \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  react-router-dom@6.30.4

npm ci --ignore-scripts --no-audit --no-fund

node <<'NODE'
const lock = require("./package-lock.json");
const expected = new Map([
  ["node_modules/@remix-run/router", "1.23.3"],
  ["node_modules/react-router", "6.30.4"],
  ["node_modules/react-router-dom", "6.30.4"],
]);

for (const [path, version] of expected) {
  const actual = lock.packages?.[path]?.version;
  if (actual !== version) {
    throw new Error(`${path}: expected ${version}, found ${actual ?? "missing"}`);
  }
}
NODE

npm ls @remix-run/router react-router react-router-dom --all
npm run build
