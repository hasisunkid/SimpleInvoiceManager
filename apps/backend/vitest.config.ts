import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'backend',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // One MariaDB container for all integration tests (TR-02), see test/global-setup.ts.
    globalSetup: ['test/global-setup.ts'],
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
