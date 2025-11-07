#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
BUILD_DIR="$BACKEND_DIR/bin"
BINARY_NAME="mcp-backend"
ARCHIVE_NAME="$BINARY_NAME.tar.gz"
CONFIG_DIR="/etc/mcp-jira-thing"
CONFIG_SAMPLE_LOCAL="$ROOT_DIR/etc/mcp-jira-thing/config.ini.sample"
SYSTEMD_UNIT_LOCAL="$ROOT_DIR/scripts/systemd/mcp-backend.service"

: "${DEPLOY_HOST:?DEPLOY_HOST must be set (e.g. production.example.com)}"
: "${DEPLOY_USER:?DEPLOY_USER must be set (e.g. deploy)}"
: "${DEPLOY_PATH:?DEPLOY_PATH must be set (e.g. /opt/mcp-backend)}"

mkdir -pv "$BUILD_DIR"

if [[ ! -f "$BUILD_DIR/$BINARY_NAME" ]]; then
  echo "[deploy] Expected prebuilt binary at $BUILD_DIR/$BINARY_NAME (build it in the pipeline before calling this script)." >&2
  exit 1
fi

echo "[deploy] Creating archive from prebuilt binary..."
tar -C "$BUILD_DIR" -czf "$BUILD_DIR/$ARCHIVE_NAME" "$BINARY_NAME"

echo "[deploy] Ensuring remote directories exist at $DEPLOY_HOST:$DEPLOY_PATH"
ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -euo pipefail; mkdir -pv '$DEPLOY_PATH' '$DEPLOY_PATH/logs'"

echo "[deploy] Uploading archive to $DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH"
scp "$BUILD_DIR/$ARCHIVE_NAME" "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"

echo "[deploy] Extracting archive on remote host"
ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -euo pipefail; cd '$DEPLOY_PATH'; tar -xzf '$ARCHIVE_NAME'; rm -f '$ARCHIVE_NAME'"

# Deploy /etc/mcp-jira-thing/config.ini.sample and ensure /etc/mcp-jira-thing/config.ini exists.
if [[ -f "$CONFIG_SAMPLE_LOCAL" ]]; then
  echo "[deploy] Ensuring remote config directory $CONFIG_DIR exists"
  ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -euo pipefail; sudo mkdir -pv '$CONFIG_DIR'"

  echo "[deploy] Uploading config.ini.sample to remote host"
  TMP_CONFIG="/tmp/config.ini.sample.$$"
  scp "$CONFIG_SAMPLE_LOCAL" "$DEPLOY_USER@$DEPLOY_HOST:$TMP_CONFIG"

  echo "[deploy] Installing config.ini.sample under $CONFIG_DIR"
  ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -euo pipefail; sudo mv '$TMP_CONFIG' '$CONFIG_DIR/config.ini.sample'; sudo chown root:root '$CONFIG_DIR/config.ini.sample'; sudo chmod 640 '$CONFIG_DIR/config.ini.sample'"

  echo "[deploy] Ensuring $CONFIG_DIR/config.ini exists (copying from sample if missing)"
  ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -euo pipefail; if [[ ! -f '$CONFIG_DIR/config.ini' ]]; then sudo cp '$CONFIG_DIR/config.ini.sample' '$CONFIG_DIR/config.ini'; sudo chown root:root '$CONFIG_DIR/config.ini'; sudo chmod 640 '$CONFIG_DIR/config.ini'; fi"
else
  echo "[deploy] WARNING: $CONFIG_SAMPLE_LOCAL not found; skipping config.ini deployment" >&2
fi

# Deploy /etc/systemd/system/mcp-backend.service unit file if available
if [[ -f "$SYSTEMD_UNIT_LOCAL" ]]; then
  echo "[deploy] Uploading systemd unit for mcp-backend"
  TMP_UNIT="/tmp/mcp-backend.service.$$"
  scp "$SYSTEMD_UNIT_LOCAL" "$DEPLOY_USER@$DEPLOY_HOST:$TMP_UNIT"

  # Use SERVICE_NAME (minus optional .service suffix) as the unit base name, defaulting to mcp-backend.
  UNIT_BASE_NAME="${SERVICE_NAME%%.service}"
  if [[ -z "$UNIT_BASE_NAME" ]]; then
    UNIT_BASE_NAME="mcp-backend"
  fi
  UNIT_PATH="/etc/systemd/system/${UNIT_BASE_NAME}.service"

  echo "[deploy] Installing systemd unit to $UNIT_PATH"
  ssh "$DEPLOY_USER@$DEPLOY_HOST" "set -euo pipefail; sudo mv '$TMP_UNIT' '$UNIT_PATH'; sudo chown root:root '$UNIT_PATH'; sudo chmod 644 '$UNIT_PATH'; sudo systemctl daemon-reload"
else
  echo "[deploy] WARNING: $SYSTEMD_UNIT_LOCAL not found; skipping systemd unit deployment" >&2
fi

if [[ -n "${SERVICE_NAME:-}" ]]; then
  echo "[deploy] Restarting systemd service $SERVICE_NAME"
  ssh "$DEPLOY_USER@$DEPLOY_HOST" "sudo systemctl restart '$SERVICE_NAME'"
else
  echo "[deploy] SERVICE_NAME not set; skipping systemd restart"
fi

echo "[deploy] Done"
