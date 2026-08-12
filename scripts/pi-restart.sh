#!/usr/bin/env bash
# Restart Homebridge container on the Pi (picks up plugin JS changes).
set -euo pipefail

PI_HOST="${PI_HOST:-pi@raspberrypi.local}"

echo "Restarting Homebridge on $PI_HOST..."
ssh -o BatchMode=yes "$PI_HOST" 'sudo docker restart homebridge >/dev/null'

for i in $(seq 1 30); do
  code=$(ssh -o BatchMode=yes "$PI_HOST" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8581/" || true)
  if [[ "$code" == "200" ]]; then
    echo "UI up (${i}s)"
    exit 0
  fi
  sleep 1
done

echo "Warning: UI did not return 200 in time" >&2
exit 1
