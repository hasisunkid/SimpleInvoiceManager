import { defineProject } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineProject({
  plugins: [vue()],
  resolve: { conditions: ['sim-source'] },
  test: {
    name: 'frontend',
    include: ['test/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    // Mounting the editor is heavy; slow CI machines need more than the 5 s default.
    testTimeout: 15_000,
  },
});
