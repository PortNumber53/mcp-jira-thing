#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
BUILD_DIR="$BACKEND_DIR/bin"
BINARY_NAME="mcp-backend"
ARCHIVE_NAME="$BINARY_NAME.tar.gz"

: "${DEPLOY_HOST:?DEPLOY_HOST must be set (e.g. production.example.com)}"
: "${DEPLOY_USER:?DEPLOY_USER must be set (e.g. deploy)}"
: "${DEPLOY_PATH:?DEPLOY_PATH must be set (e.g. /opt/mcp-backend)}"

mkdir -p "$BUILD_DIR"

if [[ ! -f "$BUILD_DIR/$BINARY_NAME" ]]; then
  echo "[deploy] Expected prebuilt binary at $BUILD_DIR/$BINARY_NAME (build it in the pipeline before calling this script)." >&2
  exit 1
fi

echo "[deploy] Creating archive from prebuilt binary..."
tar -C "$BUILD_DIR" -czf "$BUILD_DIR/$ARCHIVE_NAME" "$BINARY_NAME"

echo "[deploy] Ensuring remote directories exist at $DEPLOY_HOST:$DEPLOY_PATH"
ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -euo pipefail; mkdir -p '$DEPLOY_PATH' '$DEPLOY_PATH/logs'"

echo "[deploy] Uploading archive to $DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH"
scp "$BUILD_DIR/$ARCHIVE_NAME" "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"

echo "[deploy] Extracting archive on remote host"
ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -euo pipefail; cd '$DEPLOY_PATH'; tar -xzf '$ARCHIVE_NAME'; rm -f '$ARCHIVE_NAME'"

if [[ -n "${SERVICE_NAME:-}" ]]; then
  echo "[deploy] Restarting systemd service $SERVICE_NAME"
  ssh "$DEPLOY_USER@$DEPLOY_HOST" "sudo systemctl restart '$SERVICE_NAME'"
else
  echo "[deploy] SERVICE_NAME not set; skipping systemd restart"
fi

echo "[deploy] Done"
