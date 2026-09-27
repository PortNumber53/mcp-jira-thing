#!/usr/bin/env bash
set -euo pipefail

# Remediate CVE-2026-75931 / GHSA-5jgf-p345-68v8 in both runtime lockfiles.
# 3.1.6 is the smallest patched release compatible with ajv's ^3.0.1 range.
readonly PATCHED_VERSION="3.1.6"
readonly REPOSITORY_ROOT="$(git rev-parse --show-toplevel)"
readonly ROOT_MANIFEST="${REPOSITORY_ROOT}/package.json"
readonly MCP_MANIFEST="${REPOSITORY_ROOT}/mcp-server/package.json"
readonly TEMPORARY_DIRECTORY="$(mktemp -d)"

restore_manifests_and_clean_up() {
  if [[ -f "${TEMPORARY_DIRECTORY}/package.json" ]]; then
    cp "${TEMPORARY_DIRECTORY}/package.json" "${ROOT_MANIFEST}"
  fi
  if [[ -f "${TEMPORARY_DIRECTORY}/mcp-server-package.json" ]]; then
    cp "${TEMPORARY_DIRECTORY}/mcp-server-package.json" "${MCP_MANIFEST}"
  fi
  rm -r "${TEMPORARY_DIRECTORY}"
}
trap restore_manifests_and_clean_up EXIT

cp "${ROOT_MANIFEST}" "${TEMPORARY_DIRECTORY}/package.json"
cp "${MCP_MANIFEST}" "${TEMPORARY_DIRECTORY}/mcp-server-package.json"

manifest_hashes_before="$(shasum -a 256 "${ROOT_MANIFEST}" "${MCP_MANIFEST}")"

update_lockfile() {
  local project_directory="$1"
  local manifest_backup="$2"

  # Temporarily request the exact transitive release so npm resolves the
  # smallest patched version instead of the newest version in the ^3 range.
  npm --prefix "${project_directory}" install \
    --package-lock-only \
    --ignore-scripts \
    --no-audit \
    --no-fund \
    --save-exact \
    "fast-uri@${PATCHED_VERSION}"

  cp "${manifest_backup}" "${project_directory}/package.json"
  npm --prefix "${project_directory}" install \
    --package-lock-only \
    --ignore-scripts \
    --no-audit \
    --no-fund
}

update_lockfile "${REPOSITORY_ROOT}" "${TEMPORARY_DIRECTORY}/package.json"
update_lockfile \
  "${REPOSITORY_ROOT}/mcp-server" \
  "${TEMPORARY_DIRECTORY}/mcp-server-package.json"

manifest_hashes_after="$(shasum -a 256 "${ROOT_MANIFEST}" "${MCP_MANIFEST}")"
if [[ "${manifest_hashes_before}" != "${manifest_hashes_after}" ]]; then
  echo "Refusing remediation: npm changed a direct-dependency manifest." >&2
  exit 1
fi

node --input-type=module - "${REPOSITORY_ROOT}" "${PATCHED_VERSION}" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const [repositoryRoot, expectedVersion] = process.argv.slice(2);
const lockfiles = [
  "package-lock.json",
  "mcp-server/package-lock.json",
];

for (const relativePath of lockfiles) {
  const lockfile = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"),
  );
  const installed = lockfile.packages?.["node_modules/fast-uri"];

  if (installed?.version !== expectedVersion) {
    throw new Error(
      `${relativePath}: expected fast-uri ${expectedVersion}, found ${installed?.version ?? "nothing"}`,
    );
  }
}
NODE

npm --prefix "${REPOSITORY_ROOT}" ls fast-uri --all --package-lock-only
npm --prefix "${REPOSITORY_ROOT}/mcp-server" ls fast-uri --all --package-lock-only
