// Build de producción del banco de pruebas (perf/index.html).
//   npx vite build --config perf/vite.config.ts --outDir <dir>
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname),
  publicDir: path.resolve(__dirname, '../public'),
  plugins: [react()],
  build: { emptyOutDir: true, minify: !process.env.PERF_NO_MINIFY }
});
