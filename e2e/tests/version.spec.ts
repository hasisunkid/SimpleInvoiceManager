import { expect, test } from '@playwright/test';
import { E2E } from '../env';
import { login, nav } from './helpers';

/** AR-26 / TR-22: the UI shows the version the image was built with, linked to its release. */
test('login screen and Mehr page show the build version', async ({ page }) => {
  const label = `Version ${E2E.buildVersion}`;
  const releaseUrl = `https://github.com/hasisunkid/SimpleInvoiceManager/releases/tag/v${E2E.buildVersion}`;

  await page.goto('#/login');
  const onLogin = page.getByTestId('app-version');
  await expect(onLogin).toHaveText(label);
  await expect(onLogin).toHaveAttribute('href', releaseUrl);

  await login(page);
  await nav(page, 'Mehr');
  await expect(page.getByTestId('app-version')).toHaveText(label);

  const health = await page.request.get('api/health');
  expect((await health.json()).version).toBe(E2E.buildVersion);
});
