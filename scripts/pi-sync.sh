#!/usr/bin/env bash
# Sync built plugin into the Pi Homebridge node_modules (live, no npm pack).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PI_HOST="${PI_HOST:-pi@raspberrypi.local}"
# What Homebridge actually loads:
PI_DIR="${PI_DIR:-/home/pi/docker/homebridge/volumes/homebridge/node_modules/homebridge-wled-kit}"

cd "$ROOT"

if [[ ! -d dist ]] || [[ ! -f dist/homebridge-ui/server.js ]]; then
  echo "dist incomplete — run: npm run build"
  exit 1
fi

# Keep public UI assets fresh relative to last build:ui
if [[ -d homebridge-ui/public ]]; then
  mkdir -p dist/homebridge-ui
  rsync -a homebridge-ui/public/ dist/homebridge-ui/public/
fi

ssh -o BatchMode=yes "$PI_HOST" "sudo mkdir -p '$PI_DIR' && sudo chown -R pi:pi '$(dirname "$PI_DIR")/homebridge-wled-kit' 2>/dev/null || sudo chown -R pi:pi '$PI_DIR'"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE"
cp "$ROOT/package.json" "$ROOT/config.schema.json" "$ROOT/homebridge-wled.png" "$STAGE/" 2>/dev/null || true
[[ -f "$ROOT/README.md" ]] && cp "$ROOT/README.md" "$STAGE/"
[[ -f "$ROOT/CLAUDE.md" ]] && cp "$ROOT/CLAUDE.md" "$STAGE/"
rsync -a "$ROOT/dist/" "$STAGE/dist/"

rsync -az --delete \
  --exclude node_modules \
  "$STAGE/" "$PI_HOST:$PI_DIR/"

echo "Synced → $PI_HOST:$PI_DIR"
if [[ "${PI_RESTART:-0}" == "1" ]]; then
  "$(dirname "$0")/pi-restart.sh"
fi
