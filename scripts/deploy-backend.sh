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

echo "[deploy] Building linux/amd64 binary..."
(
  cd "$BACKEND_DIR"
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o "$BUILD_DIR/$BINARY_NAME" ./cmd/server
)

echo "[deploy] Creating archive..."
tar -C "$BUILD_DIR" -czf "$BUILD_DIR/$ARCHIVE_NAME" "$BINARY_NAME"

echo "[deploy] Uploading archive to $DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH"
scp "$BUILD_DIR/$ARCHIVE_NAME" "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"

echo "[deploy] Extracting archive on remote host"
ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -euo pipefail; mkdir -p '$DEPLOY_PATH'; cd '$DEPLOY_PATH'; tar -xzf '$ARCHIVE_NAME'; mv '$BINARY_NAME' backend; rm -f '$ARCHIVE_NAME'"

if [[ -n "${SERVICE_NAME:-}" ]]; then
  echo "[deploy] Restarting systemd service $SERVICE_NAME"
  ssh "$DEPLOY_USER@$DEPLOY_HOST" "sudo systemctl restart '$SERVICE_NAME'"
else
  echo "[deploy] SERVICE_NAME not set; skipping systemd restart"
fi

echo "[deploy] Done"
