#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
script_relative_path="scripts/remediate-dependabot-js-yaml.sh"
branch="${TASK_VAR_SUGGESTED_BRANCH:-security/dependabot-fbd33f4b7c37}"
default_branch="${TASK_VAR_DEFAULT_BRANCH:-master}"
manifest_dir="$repo_root/frontend"
lockfile="$manifest_dir/package-lock.json"
patched_version="4.3.2"

cd "$repo_root"

if [[ "$repo_root" != "/Users/grimlock/work/mcp-jira-thing" ]]; then
  echo "Refusing to run outside the supplied repository: $repo_root" >&2
  exit 1
fi

unexpected_changes="$(
  git status --porcelain --untracked-files=all |
    grep -Fv "?? $script_relative_path" |
    grep -Fv " M frontend/package-lock.json" |
    grep -Fv "M  frontend/package-lock.json" || true
)"
if [[ -n "$unexpected_changes" ]]; then
  echo "Refusing to run with unrelated working-tree changes:" >&2
  echo "$unexpected_changes" >&2
  exit 1
fi

git fetch origin "$default_branch"

if git show-ref --verify --quiet "refs/heads/$branch"; then
  git switch "$branch"
elif git ls-remote --exit-code --heads origin "refs/heads/$branch" >/dev/null 2>&1; then
  git fetch origin "$branch"
  git switch --track -c "$branch" "origin/$branch"
else
  if [[ "$(git branch --show-current)" != "$default_branch" ]]; then
    git switch "$default_branch"
  fi
  if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$default_branch")" ]]; then
    echo "Local $default_branch is not at the fetched origin/$default_branch; refusing to guess how to reconcile it." >&2
    exit 1
  fi
  git switch -c "$branch" "origin/$default_branch"
fi

node - "$lockfile" "$patched_version" <<'NODE'
const [lockfile, patchedVersion] = process.argv.slice(2)
const lock = require(lockfile)
const root = lock.packages['']
const yaml = lock.packages['node_modules/js-yaml']
const eslintRc = lock.packages['node_modules/@eslint/eslintrc']

if (!yaml || !['4.3.1', patchedVersion].includes(yaml.version)) {
  throw new Error(`Expected js-yaml 4.3.1 or ${patchedVersion}, found ${yaml?.version ?? 'nothing'}`)
}
if (root.dependencies?.['js-yaml'] || root.devDependencies?.['js-yaml']) {
  throw new Error('js-yaml unexpectedly became a direct dependency')
}
if (eslintRc?.dependencies?.['js-yaml'] !== '^4.1.0') {
  throw new Error('Expected @eslint/eslintrc to depend on js-yaml ^4.1.0')
}
NODE

registry_version="$(npm view "js-yaml@$patched_version" version)"
if [[ "$registry_version" != "$patched_version" ]]; then
  echo "npm registry did not resolve js-yaml@$patched_version as expected." >&2
  exit 1
fi

package_json_before="$(git hash-object frontend/package.json)"
(
  cd "$manifest_dir"
  npm update --package-lock-only --ignore-scripts js-yaml
)
package_json_after="$(git hash-object frontend/package.json)"
if [[ "$package_json_before" != "$package_json_after" ]]; then
  echo "The transitive remediation unexpectedly changed frontend/package.json." >&2
  exit 1
fi

node - "$lockfile" "$patched_version" <<'NODE'
const [lockfile, patchedVersion] = process.argv.slice(2)
const lock = require(lockfile)
const yaml = lock.packages['node_modules/js-yaml']

if (yaml?.version !== patchedVersion) {
  throw new Error(`Expected locked js-yaml ${patchedVersion}, found ${yaml?.version ?? 'nothing'}`)
}
NODE

(
  cd "$manifest_dir"
  npm ls js-yaml --all --package-lock-only

  audit_file="$(mktemp)"
  trap 'rm -f "$audit_file"' EXIT
  npm audit --package-lock-only --json >"$audit_file" || true
  node - "$audit_file" <<'NODE'
const [auditFile] = process.argv.slice(2)
const fs = require('node:fs')
const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'))
if (audit.vulnerabilities?.['js-yaml']) {
  throw new Error('npm audit still reports a js-yaml vulnerability')
}
NODE

  npm ci --ignore-scripts
  npm run build
)

git add "$script_relative_path" frontend/package-lock.json

if git diff --cached --quiet; then
  echo "No remediation changes to commit."
else
  git commit -m "security: update js-yaml to 4.3.2"
fi

git push -u origin "$branch"

echo "Remediation complete on $branch at $(git rev-parse HEAD)."
