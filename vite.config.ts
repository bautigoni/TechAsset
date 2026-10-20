import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Precarga de Geist (latin, peso variable): el único archivo de fuente crítico
 * (~29 kB). Vite lo emite a /assets con hash desde tokens.css; acá se busca en
 * el bundle y se inyecta el <link rel="preload"> con la URL final. Geist Mono
 * y latin-ext no se precargan (se piden cuando aparece texto que los usa).
 */
function preloadGeist(): Plugin {
  return {
    name: 'techasset:preload-geist',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const file = Object.keys(ctx.bundle || {}).find(name => /(^|\/)geist-latin-wght-normal-[^/]*\.woff2$/.test(name));
        if (!file) return [];
        return [{
          tag: 'link',
          attrs: { rel: 'preload', href: `/${file}`, as: 'font', type: 'font/woff2', crossorigin: '' },
          injectTo: 'head'
        }];
      }
    }
  };
}

/**
 * Versión del service worker: public/sw.js trae `__BUILD_ID__` y acá se
 * reemplaza por un hash de los nombres del bundle (cambian con cualquier cambio
 * de código). Así cada deploy publica un sw.js distinto: el navegador instala
 * el nuevo, la app avisa "Hay una versión nueva · Actualizar" y el caché viejo
 * se borra al activarse.
 */
function swVersion(): Plugin {
  let outDir = 'dist';
  let buildId = '';
  return {
    name: 'techasset:sw-version',
    apply: 'build',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    generateBundle(_options, bundle) {
      buildId = createHash('sha256').update(Object.keys(bundle).sort().join('|')).digest('hex').slice(0, 12);
    },
    closeBundle() {
      const file = path.join(outDir, 'sw.js');
      if (!buildId || !fs.existsSync(file)) return;
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/__BUILD_ID__/g, buildId));
    }
  };
}

export default defineConfig({
  plugins: [react(), preloadGeist(), swVersion()],
  server: {
    port: 5173,
    // Los worktrees de los agentes (.claude/worktrees), la base y las salidas de
    // los bancos no son código de la app: vigilarlos dejaba al dev server
    // gastando ~2 núcleos todo el tiempo.
    watch: {
      ignored: ['**/.claude/**', '**/data/**', '**/e2e/.out/**', '**/perf/.out/**', '**/docs/**', '**/backups/**']
    },
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/uploads': 'http://127.0.0.1:8000',
      '/sheet.csv': 'http://127.0.0.1:8000'
    }
  }
});
