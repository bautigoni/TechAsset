#!/usr/bin/env bash
# Deploy de TechAsset a producción (servicio systemd "techasset", puerto 3013).
set -euo pipefail
cd /opt/apps/techasset

echo "== git pull =="
git pull --ff-only

echo "== dependencias =="
npm install --no-audit --no-fund

if [[ "${1:-}" != "--no-build" ]]; then
  echo "== build =="
  NODE_OPTIONS=--max-old-space-size=640 npm run build
fi

echo "== restart del servicio =="
sudo systemctl restart techasset

echo "== health check =="
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null http://127.0.0.1:3013/; then
    echo "OK: TechAsset arriba en :3013 — commit $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 2
done

echo "ERROR: el servicio no respondió tras el restart."
echo "Logs: sudo journalctl -u techasset -n 50"
exit 1
