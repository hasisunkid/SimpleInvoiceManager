import { MariaDbContainer } from '@testcontainers/mariadb';
import { loadConfig, type Config } from '../../src/config.js';

/**
 * Integration tests run against a real MariaDB (TR-02).
 *
 * By default a throwaway container is started via Testcontainers. To reuse a running
 * server instead (e.g. the compose DB), set TEST_DB_HOST / TEST_DB_PORT / TEST_DB_USER /
 * TEST_DB_PASSWORD; each test file then uses its own database on that server.
 */
export interface TestDatabase {
  readonly config: Config;
  stop(): Promise<void>;
}

export async function startTestDatabase(name: string): Promise<TestDatabase> {
  const base = {
    DB_NAME: `sim_test_${name}_${process.pid}`,
    SESSION_SECRET: 'x'.repeat(32),
    LOG_LEVEL: 'silent',
  };

  if (process.env.TEST_DB_HOST) {
    const { config } = loadConfig({
      ...base,
      DB_HOST: process.env.TEST_DB_HOST,
      DB_PORT: process.env.TEST_DB_PORT ?? '3306',
      DB_USER: process.env.TEST_DB_USER ?? 'root',
      DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? '',
    });
    return { config, stop: async () => {} };
  }

  // Connect as root: the app needs CREATE DATABASE (AR-12), like the HA MariaDB service user.
  const container = await new MariaDbContainer('mariadb:11.4').withRootPassword('test').start();
  const { config } = loadConfig({
    ...base,
    DB_HOST: container.getHost(),
    DB_PORT: String(container.getPort()),
    DB_USER: 'root',
    DB_PASSWORD: 'test',
  });
  return {
    config,
    stop: async () => {
      await container.stop();
    },
  };
}
