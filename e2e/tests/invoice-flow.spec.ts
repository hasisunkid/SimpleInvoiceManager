import { expect, test } from '@playwright/test';
import { acceptNextDialog, login, nav, unique } from './helpers';

/**
 * TR-06 main flow: login → create customer → invoice from catalogue → preview → finalize →
 * download PDF → mark paid. Runs on phone, desktop and behind the ingress path.
 */
test('create, finalize, download and pay an invoice', async ({ page }, testInfo) => {
  const customer = unique(testInfo, 'E2E Kunde');

  await test.step('login', async () => {
    await login(page);
    await expect(page.getByTestId('tile-OPEN')).toBeVisible();
  });

  await test.step('create customer', async () => {
    await nav(page, 'Kunden');
    await page.getByRole('link', { name: 'Neuer Kunde' }).click();
    await page.getByLabel('Name', { exact: true }).fill(customer);
    await page.getByLabel('Straße und Hausnummer').fill('Teststraße 1');
    await page.getByLabel('PLZ').fill('12345');
    await page.getByLabel('Ort').fill('Musterstadt');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('heading', { name: 'Kunde bearbeiten' })).toBeVisible();
  });

  await test.step('new invoice from the catalogue (≤ 6 taps, NFR-UX-02)', async () => {
    await page.getByRole('button', { name: 'Neue Rechnung' }).click(); // from the customer page
    await expect(page.getByRole('heading', { name: 'Rechnungsentwurf' })).toBeVisible();
    // The customer page pre-selects the customer; on other screens: search and tap.
    await expect(page.getByText(customer)).toBeVisible();
    await page.getByRole('button', { name: 'Aus Leistungen' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Gartenabfälle entsorgen/ })
      .click();
    await expect(page.getByTestId('gross')).toHaveText('95,20 €');
    await expect(page.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();
  });

  await test.step('preview (FR-INV-12)', async () => {
    // The app opens a new tab and points it at the preview. Headless Chromium hands PDFs to the
    // download manager instead of a viewer, so we check the request the tab makes …
    const previewRequest = page
      .context()
      .waitForEvent('request', (request) =>
        /\/api\/invoices\/\d+\/preview\?v=\d+$/.test(request.url()),
      );
    await page.getByRole('button', { name: 'Vorschau (PDF)' }).click();
    const url = (await previewRequest).url();
    // … and fetch the same URL with the same session: a PDF with the draft watermark.
    const res = await page.request.get(url);
    expect(res.headers()['content-type']).toBe('application/pdf');
    expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
    for (const popup of page
      .context()
      .pages()
      .filter((p) => p !== page))
      await popup.close();
  });

  let number = '';
  await test.step('finalize (FR-INV-11)', async () => {
    const create = page.getByRole('button', { name: 'Rechnung erstellen (PDF)' });
    await expect(create).toBeEnabled();
    acceptNextDialog(page);
    await create.click();
    const created = page.getByText(/Rechnung \d+ wurde erstellt\./);
    await expect(created).toBeVisible();
    number = (await created.textContent())!.match(/Rechnung (\d+)/)![1]!;
    await expect(page.getByRole('heading', { name: `Rechnung ${number}` })).toBeVisible();
  });

  await test.step('download the stored PDF (FR-INV-15, FR-PDF-04)', async () => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'PDF herunterladen' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^RechnungsNr_${number}_.+_\\d{2}\\.\\d{2}\\.\\d{4}\\.pdf$`),
    );
    const stream = await download.createReadStream();
    const first = await new Promise<Buffer>((resolve) =>
      stream.once('data', (c) => resolve(c as Buffer)),
    );
    expect(first.subarray(0, 5).toString()).toBe('%PDF-');
  });

  await test.step('mark as paid (FR-INV-14)', async () => {
    await page.getByRole('button', { name: 'Als bezahlt markieren' }).click();
    await expect(page.getByText(/Bezahlt am \d{2}\.\d{2}\.\d{4}/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zahlung zurücknehmen' })).toBeVisible();
  });

  await test.step('the list and the dashboard reflect it (FR-INV-20, FR-INV-21)', async () => {
    await nav(page, 'Rechnungen');
    await page.getByLabel('Rechnungen suchen').fill(number);
    const row = page.getByRole('link', { name: new RegExp(`^${number} · ${customer}`) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Bezahlt')).toBeVisible();
    await nav(page, 'Start');
    await expect(page.getByTestId('tile-PAID')).toContainText(/[1-9]/);
  });
});

test('quick-create a customer in the editor (FR-CUST-05)', async ({ page }, testInfo) => {
  const name = unique(testInfo, 'Schnellkunde');
  await login(page);
  await nav(page, 'Rechnungen');
  await page.getByRole('button', { name: 'Neue Rechnung' }).click();
  await page.getByLabel('Kunden suchen').fill(name);
  await page.getByRole('button', { name: 'Neuer Kunde' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name);
  await page.getByLabel('Straße und Hausnummer').fill('Kurzweg 2');
  await page.getByLabel('PLZ').fill('12345');
  await page.getByLabel('Ort').fill('Musterstadt');
  await page.getByRole('button', { name: 'Anlegen und übernehmen' }).click();
  await expect(page.getByText('Ausgewählter Kunde')).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();
  // Clean up: drafts can be deleted.
  acceptNextDialog(page);
  await page.getByRole('button', { name: 'Entwurf löschen' }).click();
  await expect(page.getByRole('heading', { name: 'Rechnungen' })).toBeVisible();
});
