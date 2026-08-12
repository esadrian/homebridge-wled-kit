#!/usr/bin/env bash
# Ensure Pi uses homebridge-wled-kit from node_modules (no .tgz) and do first sync.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PI_HOST="${PI_HOST:-pi@raspberrypi.local}"
HB="/home/pi/docker/homebridge/volumes/homebridge"

echo "Building..."
# Skip prebuild (lint/tests) for faster setup — use full npm run build if you prefer
cd "$ROOT"
npx tsc
npm run build:ui

echo "Pointing package.json away from .tgz..."
ssh -o BatchMode=yes "$PI_HOST" "sudo python3 - <<'PY'
import json, os
p='$HB/package.json'
with open(p) as f: data=json.load(f)
deps=data.setdefault('dependencies', {})
deps.pop('homebridge-simpler-wled', None)
# Keep a fixed local version string so npm won't try to fetch from registry
# Actual code is whatever is in node_modules/homebridge-wled-kit (rsync target)
deps['homebridge-wled-kit'] = '1.0.0-local.1'
with open(p,'w') as f: json.dump(data,f,indent=2); f.write('\n')
# remove leftover tarball so nobody reinstalls it by accident
for name in os.listdir('$HB'):
    if name.startswith('homebridge-wled-kit-') and name.endswith('.tgz'):
        os.remove(os.path.join('$HB', name))
        print('removed', name)
print('dependency set to', deps['homebridge-wled-kit'])
PY"

echo "Initial sync into node_modules..."
"$ROOT/scripts/pi-sync.sh"

# Ensure runtime deps exist inside the plugin folder if missing
ssh -o BatchMode=yes "$PI_HOST" \
  "sudo docker exec homebridge sh -c 'cd /homebridge/node_modules/homebridge-wled-kit && npm install --omit=dev --no-package-lock'"

"$ROOT/scripts/pi-restart.sh"

echo
echo "Listo. Flujo diario:"
echo "  npm run pi:dev          # watch build + sync automático"
echo "  npm run pi:sync         # sync manual tras un build"
echo "  PI_RESTART=1 npm run pi:sync   # sync + reiniciar Homebridge"
echo
echo "UI (HTML/CSS/JS del iframe): basta sync + hard refresh (Cmd+Shift+R)."
echo "Código del plugin (dist/*.js runtime): hace falta reiniciar (pi:restart)."
