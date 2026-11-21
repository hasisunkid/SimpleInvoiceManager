import { expect, type Page, type TestInfo } from '@playwright/test';
import { E2E } from '../env';

/** Unique suffix per project and run, so the three projects never collide in the shared DB. */
export function unique(testInfo: TestInfo, name: string): string {
  return `${name} ${testInfo.project.name} ${Date.now().toString(36)}`;
}

export async function login(page: Page, username = 'admin', password = E2E.adminPassword) {
  await page.goto('#/login');
  await page.getByLabel('Benutzername').fill(username);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** Bottom bar on phones, top bar on desktop – same links. */
export async function nav(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Hauptmenü' }).getByRole('link', { name }).click();
}

/** Accept the next confirmation dialog (destructive actions ask first, NFR-UX-03). */
export function acceptNextDialog(page: Page) {
  page.once('dialog', (dialog) => void dialog.accept());
}
