#!/usr/bin/env bash
# Deploy de TechAsset a produccion (servicio systemd "techasset", puerto 3013).
#
# Produccion NO es Docker: Caddy proxya techasset.bauhub.online -> 127.0.0.1:3013,
# donde escucha el systemd. Actualizar archivos NO alcanza: node no relee el
# codigo del disco, siempre hay que reiniciar el servicio (este script lo hace).
#
# ORIGIN: esta VM no tiene credenciales de GitHub, asi que el codigo llega por
# un git bundle que se sube por scp. El bundle vive en /tmp y se borra al
# reiniciar la VM, por eso "git pull" falla con "does not appear to be a git
# repository" cuando el bundle de la vez pasada ya no esta. En ese caso el
# script te dice exactamente que hacer en vez de morir con un error de git.
#
# Uso:
#   ./deploy.sh             pull + deps + build + restart + health check
#   ./deploy.sh --no-build  igual pero sin build (si subiste dist/ ya buildeado)
#   ./deploy.sh --no-pull   solo deps + build + restart (codigo ya actualizado)
set -euo pipefail
cd /opt/apps/techasset

if [[ "${1:-}" != "--no-pull" ]]; then
  ORIGIN_URL="$(git remote get-url origin 2>/dev/null || echo '')"
  # Si el origin es un bundle que ya no existe, avisar con instrucciones claras.
  if [[ "$ORIGIN_URL" == /* && ! -e "$ORIGIN_URL" ]]; then
    echo "ERROR: el origin apunta a un bundle que ya no existe:"
    echo "  $ORIGIN_URL"
    echo
    echo "Los bundles viven en /tmp y se borran al reiniciar la VM."
    echo "Desde la maquina de desarrollo, con el commit ya pusheado a GitHub:"
    echo
    echo "  HEAD_ACTUAL=$(git rev-parse --short HEAD)"
    echo "  git bundle create /tmp/techasset.bundle \${HEAD_ACTUAL}..main"
    echo "  scp /tmp/techasset.bundle oracle:/tmp/techasset.bundle"
    echo "  ssh oracle 'cd /opt/apps/techasset && git remote set-url origin /tmp/techasset.bundle && ./deploy.sh'"
    echo
    echo "(Si solo querés rebuildear lo que ya está en disco: ./deploy.sh --no-pull)"
    exit 1
  fi
  echo "== git pull =="
  git pull --ff-only
fi

echo "== dependencias =="
npm install --no-audit --no-fund

if [[ "${1:-}" != "--no-build" ]]; then
  echo "== build (la VM tiene 1GB de RAM: tarda ~1-3 min) =="
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

echo "ERROR: el servicio no respondio tras el restart."
echo "Logs: sudo journalctl -u techasset -n 50"
exit 1
