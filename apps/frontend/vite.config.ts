import { defineConfig, defaultClientConditions } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  // AR-13: relative asset URLs so the build works under any Home Assistant ingress path
  // (e.g. /api/hassio_ingress/<token>/) as well as at "/" for direct access.
  base: './',
  plugins: [vue()],
  // Consume workspace packages from TypeScript sources (see "source" export condition).
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8099' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
