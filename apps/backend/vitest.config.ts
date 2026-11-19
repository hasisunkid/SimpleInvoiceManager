import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'backend',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Integration tests start a real MariaDB (TR-02); give the container time to boot.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
