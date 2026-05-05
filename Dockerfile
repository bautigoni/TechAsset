# TechAsset - NFS · Docker image
# Node 22 sobre Debian (no Alpine: better-sqlite3 compila mejor con glibc).

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=8000 \
    NPM_CONFIG_LOGLEVEL=warn

WORKDIR /app

# Toolchain mínimo para compilar better-sqlite3.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
        ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Dependencias primero (cacheable).
COPY package.json package-lock.json* ./
RUN npm install --include=dev

# Resto del proyecto.
COPY . .

# Build del frontend (Vite -> dist/).
RUN npm run build

# Limpieza de devDeps para reducir imagen.
RUN npm prune --omit=dev

# La carpeta data se monta como volumen; la creamos por si se levanta sin volumen.
RUN mkdir -p /app/data /app/data/tmp

EXPOSE 8000

CMD ["npm", "run", "start"]
