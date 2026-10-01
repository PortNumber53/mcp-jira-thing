#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[remediate] Updating the root lockfile to qs 6.16.0"
npm --prefix "$ROOT_DIR" update qs \
  --package-lock-only \
  --ignore-scripts \
  --no-audit \
  --no-fund

echo "[remediate] Updating the MCP server's compatible Express patch and qs tree"
npm --prefix "$ROOT_DIR/mcp-server" update express body-parser qs \
  --package-lock-only \
  --ignore-scripts \
  --no-audit \
  --no-fund

echo "[remediate] Verifying both resolved dependency graphs"
npm --prefix "$ROOT_DIR" ls qs --all --package-lock-only
npm --prefix "$ROOT_DIR/mcp-server" ls express body-parser qs --all --package-lock-only

node - "$ROOT_DIR" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
const expected = new Map([
  ['package-lock.json', '6.16.0'],
  ['mcp-server/package-lock.json', '6.16.0'],
]);

for (const [relativeLockfile, expectedVersion] of expected) {
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, relativeLockfile), 'utf8'));
  const resolved = Object.entries(lockfile.packages ?? {})
    .filter(([packagePath]) => packagePath === 'node_modules/qs' || packagePath.endsWith('/node_modules/qs'))
    .map(([, metadata]) => metadata.version);

  if (resolved.length === 0 || resolved.some((version) => version !== expectedVersion)) {
    throw new Error(`${relativeLockfile} resolves qs versions [${resolved.join(', ')}], expected only ${expectedVersion}`);
  }
}

const mcpLock = JSON.parse(fs.readFileSync(path.join(root, 'mcp-server/package-lock.json'), 'utf8'));
const expressVersion = mcpLock.packages?.['node_modules/express']?.version;
if (expressVersion !== '4.22.3') {
  throw new Error(`mcp-server/package-lock.json resolves express ${expressVersion}, expected 4.22.3`);
}

console.log('[remediate] Lockfile versions verified');
NODE
