#!/usr/bin/env bash
# Example: rsync built plugin into a remote Homebridge node_modules folder.
# Copy to .local/pi-sync.sh — see scripts/pi.env.example for configuration.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$ROOT/.local/pi.env" ]] && source "$ROOT/.local/pi.env"

PI_HOST="${PI_HOST:?Set PI_HOST in .local/pi.env}"
PI_DIR="${PI_DIR:?Set PI_DIR in .local/pi.env}"

cd "$ROOT"

if [[ ! -d dist ]] || [[ ! -f dist/homebridge-ui/server.js ]]; then
  echo "dist incomplete — run: npm run build"
  exit 1
fi

rsync -az --delete \
  --exclude node_modules \
  dist/ package.json config.schema.json \
  "$PI_HOST:$PI_DIR/"

echo "Synced → $PI_HOST:$PI_DIR"
