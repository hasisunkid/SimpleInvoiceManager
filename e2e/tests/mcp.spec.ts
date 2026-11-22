import { expect, test } from '@playwright/test';
import { appUrl } from '../env';
import { login, nav, unique } from './helpers';

/**
 * M9 end to end (FR-MCP-03, -06, -10): a user creates an AI access key in *Profil*, an
 * assistant creates a draft through /mcp (direct port, like a real MCP client), and the person
 * finds it under "Von KI erstellt" and confirms it.
 */
test('an AI assistant writes a draft that a person checks', async ({ page }, testInfo) => {
  const customer = unique(testInfo, 'KI Kunde');
  let key = '';

  await test.step('create an access key in Profil', async () => {
    await login(page);
    await nav(page, 'Mehr');
    await page.getByRole('link', { name: /Mein Profil/ }).click();
    await page.getByLabel('Name des Zugangs').fill(`E2E ${testInfo.project.name}`);
    await page.getByRole('button', { name: 'Zugang erstellen' }).click();
    key = (await page.getByTestId('token-secret').textContent()) ?? '';
    expect(key).toMatch(/^sim_/);
  });

  let draftId = 0;
  await test.step('the assistant creates a draft via MCP', async () => {
    const res = await page.request.post(`${appUrl}mcp`, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_invoice_draft',
          arguments: {
            customer: {
              name: customer,
              type: 'PRIVATE',
              street: 'Weg 1',
              zip: '12345',
              city: 'Musterstadt',
            },
            positions: [
              {
                title: 'Hecke schneiden',
                type: 'WORK',
                quantity: '2',
                unit: 'h',
                unitPrice: '45.00',
              },
            ],
          },
        },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const result = JSON.parse(body.result.content[0].text);
    expect(result.customer).toMatchObject({ created: true });
    expect(result.draft.totals).toMatchObject({ net: '90.00', gross: '107.10' });
    draftId = result.draft.id;
  });

  await test.step('the person finds it under "Von KI erstellt" and confirms it', async () => {
    await nav(page, 'Rechnungen');
    await page.getByLabel('Nur „Von KI erstellt“').check();
    const row = page.getByRole('link', { name: new RegExp(customer) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Von KI erstellt')).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(new RegExp(`#/invoices/${draftId}$`));
    const notice = page.getByTestId('ai-notice');
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Geprüft' }).click();
    await expect(notice).toBeHidden();
  });
});
