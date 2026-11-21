import path from 'node:path';
import { expect, test } from '@playwright/test';
import { login, nav, unique } from './helpers';

/** TR-06: admin creates a user (who must change the password) and uploads a logo. */
test('admin creates a user who must change the password', async ({ page, browser }, testInfo) => {
  const username = unique(testInfo, 'e2e').toLowerCase().replace(/\s+/g, '.');
  await login(page);
  await nav(page, 'Mehr');
  await page.getByRole('link', { name: /Verwaltung/ }).click();
  await page
    .getByRole('link', { name: /Benutzer/ })
    .first()
    .click();
  await page.getByRole('link', { name: 'Neuer Benutzer' }).click();
  await page.getByLabel('Benutzername').fill(username);
  await page.getByLabel('Name', { exact: true }).fill('E2E Mitarbeiterin Łucja');
  await page.getByLabel('Start-Passwort').fill('start-password-1');
  await page.getByRole('button', { name: 'Benutzer anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Benutzer bearbeiten' })).toBeVisible();

  // The new user logs in on another device and has to choose a new password first.
  const context = await browser.newContext({ ...testInfo.project.use, locale: 'de-DE' });
  const other = await context.newPage();
  await login(other, username, 'start-password-1');
  await expect(other.getByText('Bitte vergeben Sie ein neues Passwort')).toBeVisible();
  await other.getByLabel('Aktuelles Passwort').fill('start-password-1');
  await other.getByLabel('Neues Passwort', { exact: true }).fill('my-own-password-1');
  await other.getByLabel('Neues Passwort wiederholen').fill('my-own-password-1');
  await other.getByRole('button', { name: 'Passwort ändern' }).click();
  await expect(other.getByRole('heading', { name: /Hallo E2E Mitarbeiterin Łucja/ })).toBeVisible();
  // Normal users do not see the admin area.
  await nav(other, 'Mehr');
  await expect(other.getByRole('link', { name: /Verwaltung/ })).toHaveCount(0);
  await context.close();
});

test('admin uploads a logo and previews the invoice design', async ({ page }) => {
  await login(page);
  await nav(page, 'Mehr');
  await page.getByRole('link', { name: /Verwaltung/ }).click();
  await page.getByRole('link', { name: /Rechnungsdesign/ }).click();
  await page
    .locator('#logo-file')
    .setInputFiles(path.join(import.meta.dirname, '../fixtures/logo.svg'));
  await expect(page.getByRole('img', { name: 'Logo' })).toBeVisible();
  await page.getByRole('button', { name: 'Vorschau erstellen' }).click();
  await expect(page.getByRole('link', { name: 'Vorschau öffnen' })).toBeVisible();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Rechnungsdesign gespeichert.')).toBeVisible();
  // Reset to keep the other projects' screenshots comparable.
  await page.getByRole('button', { name: 'Logo entfernen' }).click();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Rechnungsdesign gespeichert.')).toBeVisible();
});

test('wrong password shows a plain-language message', async ({ page }) => {
  await page.goto('#/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort', { exact: true }).fill('definitely-wrong');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('alert')).toHaveText('Benutzername oder Passwort ist falsch.');
});
