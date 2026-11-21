import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, nav } from './helpers';

/**
 * NFR-UX-04: no WCAG 2.1 A/AA violations (incl. text contrast, labels, semantics) on the main
 * screens – phone and desktop.
 */
async function expectAccessible(page: Page, screen: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 3)
        .join(' | ')}`,
  );
  expect(summary, screen).toEqual([]);
}

test('main screens are accessible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'ingress', 'same UI as desktop');
  await page.goto('#/login');
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  await expectAccessible(page, 'login');

  await login(page);
  await expect(page.getByTestId('tile-OPEN')).toBeVisible();
  await expectAccessible(page, 'start');

  await nav(page, 'Rechnungen');
  await expect(page.getByRole('heading', { name: 'Rechnungen' })).toBeVisible();
  await expectAccessible(page, 'invoice list');

  await page.getByRole('button', { name: 'Neue Rechnung' }).click();
  await expect(page.getByRole('heading', { name: 'Rechnungsentwurf' })).toBeVisible();
  await page.getByRole('button', { name: 'Freie Position' }).click();
  await expectAccessible(page, 'invoice editor');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Entwurf löschen' }).click();
  // Deleting returns to the invoice list – wait for it before navigating on.
  await expect(page).toHaveURL(/#\/invoices$/);

  await nav(page, 'Kunden');
  await expect(page.getByRole('heading', { name: 'Kunden' })).toBeVisible();
  await expectAccessible(page, 'customers');

  await nav(page, 'Mehr');
  await page.getByRole('link', { name: /Firmendaten/ }).click();
  await expect(page.getByRole('heading', { name: 'Firmendaten' })).toBeVisible();
  await expectAccessible(page, 'company');

  await nav(page, 'Mehr');
  await page.getByRole('link', { name: /Verwaltung/ }).click();
  await page.getByRole('link', { name: /Rechnungsdesign/ }).click();
  await expect(page.getByRole('heading', { name: 'Rechnungsdesign' })).toBeVisible();
  await expectAccessible(page, 'invoice design');
});
