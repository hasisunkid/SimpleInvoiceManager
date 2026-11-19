import { MariaDbContainer, type StartedMariaDbContainer } from '@testcontainers/mariadb';
import type { TestProject } from 'vitest/node';

export interface TestDbServer {
  host: string;
  port: number;
  user: string;
  password: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    testDbServer: TestDbServer;
  }
}

let container: StartedMariaDbContainer | undefined;

/**
 * Starts one MariaDB for the whole backend test run (TR-02); every test file creates its own
 * database on it. Set TEST_DB_HOST (+ TEST_DB_PORT/USER/PASSWORD) to use an existing server.
 */
export async function setup(project: TestProject): Promise<void> {
  if (process.env.TEST_DB_HOST) {
    project.provide('testDbServer', {
      host: process.env.TEST_DB_HOST,
      port: Number(process.env.TEST_DB_PORT ?? 3306),
      user: process.env.TEST_DB_USER ?? 'root',
      password: process.env.TEST_DB_PASSWORD ?? '',
    });
    return;
  }
  // Root is needed for CREATE DATABASE (AR-12), like the HA MariaDB service user.
  container = await new MariaDbContainer('mariadb:11.4').withRootPassword('test').start();
  project.provide('testDbServer', {
    host: container.getHost(),
    port: container.getPort(),
    user: 'root',
    password: 'test',
  });
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
