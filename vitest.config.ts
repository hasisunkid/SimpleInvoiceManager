import { defineConfig } from 'vitest/config';

// One entry point for `npm test` (TR-08): unit + integration tests of all workspaces.
export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    projects: [
      'packages/domain',
      'packages/i18n',
      'apps/backend',
      'apps/frontend',
      // Release tooling (AR-20..AR-24, TR-20).
      {
        test: {
          name: 'release',
          include: ['scripts/**/*.test.mjs'],
          environment: 'node',
          testTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/domain/src/**'],
      thresholds: {
        'packages/domain/src/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});
