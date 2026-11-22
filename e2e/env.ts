/** Shared settings of the E2E run (TR-06, TR-07). */
export const E2E = {
  /** Compose project with its own volumes – never touches the development stack. */
  project: process.env.E2E_PROJECT ?? 'sim-e2e',
  appPort: Number(process.env.E2E_APP_PORT ?? 8199),
  dbPort: Number(process.env.E2E_DB_PORT ?? 3399),
  ingressPort: Number(process.env.E2E_INGRESS_PORT ?? 8198),
  ingressPath: '/api/hassio_ingress/abc123',
  initialAdminPassword: 'e2e-initial-admin-pw',
  adminPassword: 'e2e-admin-password-1',
  /** AR-26 / TR-22: built into the image as BUILD_VERSION; the UI must show exactly this. */
  buildVersion: process.env.E2E_BUILD_VERSION ?? '0.0.0-e2e',
};

export const appUrl = `http://localhost:${E2E.appPort}/`;
export const ingressUrl = `http://localhost:${E2E.ingressPort}${E2E.ingressPath}/`;
