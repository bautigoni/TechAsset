import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin, type Rollup } from 'vite';
type OutputChunk = Rollup.OutputChunk;
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
 * Pantalla de arranque sin esperar el CSS (QA de lanzamiento, ítem 5): un
 * <link rel="stylesheet"> en el <head> frena el primer pintado de TODA la
 * página hasta que baja (con 3G lento, ~3 s más mirando un fondo vacío). Se
 * mueve al <body>, justo después de #boot: el navegador pinta la marca y
 * "Cargando…" (con su CSS en línea) apenas llega el HTML, y el JS de la app
 * igual espera a que la hoja cargue (bloquea scripts), así no hay contenido
 * sin estilos.
 */
function stylesAfterBoot(): Plugin {
  return {
    name: 'techasset:styles-after-boot',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const links: string[] = [];
        const withoutLinks = html.replace(/\s*<link rel="stylesheet"[^>]*>/g, match => { links.push(match.trim()); return ''; });
        if (!links.length || !withoutLinks.includes('<!-- /boot -->')) return html;
        return withoutLinks.replace('<!-- /boot -->', `<!-- /boot -->\n    ${links.join('\n    ')}`);
      }
    }
  };
}

/**
 * Landing / ingreso en frío (QA de lanzamiento, ítem 5): sus chunks se piden
 * recién cuando el JS de entrada terminó de bajar y correr (con 3G lento, a
 * los ~7 s). Un script en línea del <head> los precarga junto con la entrada,
 * pero SOLO si no hay sesión recordada en este navegador (ni la cookie de pista
 * techasset_signed_in, ver server/routes/auth.routes.js) y la URL es de una
 * pantalla sin sesión: a quien ya entra a la app no le baja nada de más.
 */
function preloadAuthScreens(): Plugin {
  return {
    name: 'techasset:preload-auth-screens',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return [];
        const chunks = Object.values(bundle).filter((item): item is OutputChunk => item.type === 'chunk');
        const entry = chunks.find(chunk => chunk.isEntry);
        const filesFor = (module: RegExp) => {
          const start = chunks.find(chunk => chunk.facadeModuleId && module.test(chunk.facadeModuleId.replace(/\\/g, '/')));
          const js = new Set<string>();
          const css = new Set<string>();
          const visit = (chunk: OutputChunk | undefined) => {
            if (!chunk || chunk === entry || js.has(chunk.fileName)) return;
            js.add(chunk.fileName);
            (chunk as OutputChunk & { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata?.importedCss?.forEach(file => css.add(file));
            chunk.imports.forEach(file => visit(chunks.find(item => item.fileName === file)));
          };
          visit(start);
          return { js: [...js].map(file => `/${file}`), css: [...css].map(file => `/${file}`) };
        };
        const landing = filesFor(/\/components\/auth\/LandingPage\.tsx$/);
        const login = filesFor(/\/components\/auth\/LoginPage\.tsx$/);
        if (!landing.js.length && !login.js.length) return [];
        const code = `(function(){try{if(localStorage.getItem('techasset_session_cache')||/(^|; *)techasset_signed_in=1/.test(document.cookie))return}catch(e){}
var p=location.pathname.toLowerCase(),s=${JSON.stringify({ landing, login })};
var l=p==='/'?s.landing:(p==='/login'||p==='/register'||p.indexOf('/sede/')===0)?s.login:null;if(!l)return;
function add(rel,href,as){var e=document.createElement('link');e.rel=rel;e.href=href;if(as)e.as=as;e.crossOrigin='';document.head.appendChild(e)}
l.js.forEach(function(h){add('modulepreload',h)});l.css.forEach(function(h){add('preload',h,'style')})})();`;
        return [{ tag: 'script', children: code, injectTo: 'head' }];
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
  plugins: [react(), preloadGeist(), preloadAuthScreens(), stylesAfterBoot(), swVersion()],
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
