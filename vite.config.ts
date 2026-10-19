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

export default defineConfig({
  plugins: [react(), preloadGeist()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/uploads': 'http://127.0.0.1:8000',
      '/sheet.csv': 'http://127.0.0.1:8000'
    }
  }
});
