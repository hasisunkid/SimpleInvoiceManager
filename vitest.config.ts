import { defineConfig } from 'vitest/config';

// One entry point for `npm test` (TR-08): unit + integration tests of all workspaces.
export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    projects: ['packages/domain', 'packages/i18n', 'apps/backend', 'apps/frontend'],
    coverage: {
      provider: 'v8',
      include: ['packages/domain/src/**'],
      thresholds: {
        'packages/domain/src/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});
