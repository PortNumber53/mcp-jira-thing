#!/bin/sh
set -eu

# GHSA-4cwx-7wf7-3272 affects undici 7.28.0 in the frontend toolchain.
# wrangler 4.120.0 is the first release in the declared ^4.119.0 range whose
# miniflare dependency resolves the patched undici 7.29.0 release.

repo_root=$(git rev-parse --show-toplevel)
frontend_dir="$repo_root/frontend"
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

cd "$frontend_dir"
cp package.json "$work_dir/package.json"
cp package-lock.json "$work_dir/package-lock.json"

node <<'NODE'
const manifest = require('./package.json')
const lock = require('./package-lock.json')

if (manifest.devDependencies?.wrangler !== '^4.119.0') {
  throw new Error('Expected frontend wrangler declaration to remain ^4.119.0')
}

const resolved = lock.packages?.['node_modules/undici']?.version
if (resolved !== '7.28.0' && resolved !== '7.29.0') {
  throw new Error(`Refusing to update unexpected undici version: ${resolved}`)
}
NODE

# Resolve the smallest compatible patched parent release in a temporary npm
# rewrite. Only transplant dependency records on the vulnerable path so npm
# version-specific lockfile normalization cannot introduce unrelated changes.
npm install \
  --package-lock-only \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  --save-dev \
  --save-exact \
  wrangler@4.120.0
cp "$work_dir/package.json" package.json

node - "$work_dir/package-lock.json" <<'NODE'
const fs = require('node:fs')
const baselinePath = process.argv[2]
const baseline = require(baselinePath)
const resolved = require('./package-lock.json')
const paths = [
  'node_modules/wrangler',
  'node_modules/miniflare',
  'node_modules/undici',
]

for (const path of paths) {
  baseline.packages[path] = resolved.packages[path]
}

fs.writeFileSync('./package-lock.json', `${JSON.stringify(baseline, null, 2)}\n`)
NODE

node <<'NODE'
const manifest = require('./package.json')
const lock = require('./package-lock.json')
const packages = lock.packages

const expected = {
  'node_modules/wrangler': '4.120.0',
  'node_modules/miniflare': '5.20260801.1-alpha',
  'node_modules/undici': '7.29.0',
}

if (manifest.devDependencies?.wrangler !== '^4.119.0') {
  throw new Error('The remediation changed the frontend wrangler declaration')
}
if (packages?.['']?.devDependencies?.wrangler !== '^4.119.0') {
  throw new Error('The root lockfile entry does not match package.json')
}

for (const [path, version] of Object.entries(expected)) {
  const actual = packages?.[path]?.version
  if (actual !== version) {
    throw new Error(`Expected ${path} ${version}, found ${actual}`)
  }
}

if (packages['node_modules/miniflare'].dependencies?.undici !== '7.29.0') {
  throw new Error('miniflare does not require patched undici 7.29.0')
}

console.log('Validated wrangler -> miniflare -> undici patched dependency path')
NODE

npm ls undici --package-lock-only --all
