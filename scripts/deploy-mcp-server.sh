#!/usr/bin/env bash
set -euo pipefail

# Deploys the Node MCP server (mcp-server/ + shared src/) to the production host.
# Follows the same pattern as deploy-backend.sh.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SYSTEMD_UNIT_LOCAL="$ROOT_DIR/scripts/systemd/mcp-jira-server.service"

: "${DEPLOY_HOST:?DEPLOY_HOST must be set}"
: "${DEPLOY_USER:?DEPLOY_USER must be set}"
: "${DEPLOY_PATH:?DEPLOY_PATH must be set (e.g. /var/www/vhosts/api-jira-thing.truvis.co)}"
: "${MCP_SESSION_API_TOKEN:?MCP_SESSION_API_TOKEN must be set}"

REMOTE_MCP_DIR="$DEPLOY_PATH/mcp-server"
REMOTE_SRC_DIR="$DEPLOY_PATH/src"

echo "[deploy-mcp] Ensuring remote directories exist at $DEPLOY_HOST:$DEPLOY_PATH"
ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -euo pipefail; mkdir -pv '$REMOTE_MCP_DIR' '$REMOTE_SRC_DIR'"

# --- Sync mcp-server/ (excluding node_modules and .env) ---
echo "[deploy-mcp] Syncing mcp-server/ to $DEPLOY_HOST:$REMOTE_MCP_DIR"
rsync -avz --delete --exclude node_modules --exclude .env \
  "$ROOT_DIR/mcp-server/" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_MCP_DIR/"

# --- Sync shared src/ (excluding test files and node_modules) ---
echo "[deploy-mcp] Syncing src/ to $DEPLOY_HOST:$REMOTE_SRC_DIR"
rsync -avz --delete --exclude node_modules --exclude '*.test.ts' \
  "$ROOT_DIR/src/" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_SRC_DIR/"

# --- Sync root package.json + package-lock.json (for shared src deps) ---
echo "[deploy-mcp] Syncing root package.json to $DEPLOY_HOST:$DEPLOY_PATH"
rsync -avz \
  "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" \
  "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"

# --- Install dependencies ---
echo "[deploy-mcp] Installing mcp-server dependencies"
ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -euo pipefail; cd '$REMOTE_MCP_DIR' && npm ci"

echo "[deploy-mcp] Installing root dependencies (for shared src/)"
ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -euo pipefail; cd '$DEPLOY_PATH' && npm ci"

# --- Generate .env file ---
echo "[deploy-mcp] Generating .env for MCP server"
LOCAL_TMP_ENV="$(mktemp)"
cleanup() { rm -f "$LOCAL_TMP_ENV"; }
trap cleanup EXIT

{
  echo "# Managed by CI deploy script. Do not edit on the server."
  echo "MCP_SERVER_PORT=${MCP_SERVER_PORT:-3001}"
  echo "BACKEND_BASE_URL=${BACKEND_BASE_URL:-http://localhost:18111}"
  echo "MCP_SESSION_API_TOKEN=${MCP_SESSION_API_TOKEN}"
  echo "SESSION_SECRET=${MCP_SESSION_API_TOKEN}"
  if [[ -n "${GOOGLE_CLIENT_ID:-}" ]]; then
    echo "GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}"
  fi
  if [[ -n "${GOOGLE_CLIENT_SECRET:-}" ]]; then
    echo "GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}"
  fi
  echo "LOG_LEVEL=${LOG_LEVEL:-info}"
} > "$LOCAL_TMP_ENV"

scp "$LOCAL_TMP_ENV" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_MCP_DIR/.env"
ssh "$DEPLOY_USER@$DEPLOY_HOST" "chmod 600 '$REMOTE_MCP_DIR/.env'"

# --- Deploy systemd unit ---
if [[ -f "$SYSTEMD_UNIT_LOCAL" ]]; then
  echo "[deploy-mcp] Uploading systemd unit"
  TMP_UNIT="/tmp/mcp-jira-server.service.$$"
  scp "$SYSTEMD_UNIT_LOCAL" "$DEPLOY_USER@$DEPLOY_HOST:$TMP_UNIT"
  ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -euo pipefail; sudo mv '$TMP_UNIT' /etc/systemd/system/mcp-jira-server.service; sudo chown root:root /etc/systemd/system/mcp-jira-server.service; sudo chmod 644 /etc/systemd/system/mcp-jira-server.service; sudo systemctl daemon-reload; sudo systemctl enable mcp-jira-server.service"
fi

# --- Restart service ---
echo "[deploy-mcp] Restarting mcp-jira-server service"
ssh "$DEPLOY_USER@$DEPLOY_HOST" "sudo systemctl restart mcp-jira-server.service"

echo "[deploy-mcp] Done"
