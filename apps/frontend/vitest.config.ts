import { defineProject } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineProject({
  plugins: [vue()],
  resolve: { conditions: ['source'] },
  test: { name: 'frontend', include: ['test/**/*.test.ts'], environment: 'jsdom' },
});
