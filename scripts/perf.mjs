// NFR-PERF-01 measurement against a running stack (default: the E2E compose stack).
//   node scripts/perf.mjs [baseUrl] [adminPassword]
// Seeds 5 000 invoices directly into the database (via `docker exec` on the MariaDB container),
// then measures p95 response times of list/summary requests and the PDF generation time of a
// 3-page invoice, and samples container memory (idle and peak).
import { execFileSync } from 'node:child_process';

const base = process.argv[2] ?? 'http://localhost:8199/';
const password = process.argv[3] ?? 'e2e-admin-password-1';
const project = process.env.E2E_PROJECT ?? 'sim-e2e';
const app = process.env.PERF_APP ?? `${project}-app-1`;
const dbContainer = `${project}-db-1`;

const sql = (statement) =>
  execFileSync(
    'docker',
    ['exec', '-i', dbContainer, 'mariadb', '-uroot', '-proot', 'simpleinvoice'],
    {
      input: statement,
    },
  ).toString();
/** Container memory from cgroup v2: current usage and the peak since the container started. */
const cgroupMiB = (file) =>
  Number(execFileSync('docker', ['exec', app, 'cat', `/sys/fs/cgroup/${file}`]).toString()) /
  1024 /
  1024;
const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

let cookie = '';
let csrf = 'x';
async function call(method, path, body) {
  const res = await fetch(new URL(`api/${path}`, base), {
    method,
    headers: {
      'X-CSRF-Token': csrf,
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  const type = res.headers.get('content-type') ?? '';
  return type.includes('json') ? res.json() : Buffer.from(await res.arrayBuffer());
}

async function timed(fn) {
  const started = performance.now();
  await fn();
  return performance.now() - started;
}

// ---- seed ----
csrf = (await call('POST', 'auth/login', { username: 'admin', password })).csrfToken;
const customer = (await call('GET', 'customers?limit=1')).items[0];
const existing = Number(
  sql("SELECT COUNT(*) FROM invoice WHERE number LIKE 'PERF%';").split('\n')[1],
);
if (existing < 5000) {
  const values = [];
  for (let i = existing; i < 5000; i++) {
    const day = new Date(Date.UTC(2024, 0, 1) + (i % 700) * 86_400_000).toISOString().slice(0, 10);
    const status = ['OPEN', 'PAID', 'CANCELLED', 'DRAFT'][i % 4];
    values.push(
      `('PERF${i}','${status}',${customer.id},'${day}','${day}',30,DATE_ADD('${day}', INTERVAL 30 DAY),'','','','','REGULAR',${1000 + i},${i % 4 === 1 ? `'${day}'` : 'NULL'},'{"name":"Kunde ${i % 300}"}')`,
    );
  }
  for (let i = 0; i < values.length; i += 1000) {
    sql(
      'INSERT INTO invoice (number,status,customer_id,invoice_date,service_date_from,payment_term_days,due_date,site_address,subject,intro_text,closing_text,tax_mode,gross_total_cents,paid_at,buyer_snapshot) VALUES ' +
        values.slice(i, i + 1000).join(',') +
        ';',
    );
  }
}
console.log('invoices in DB:', sql('SELECT COUNT(*) FROM invoice;').split('\n')[1]);

// ---- idle memory (after the seed, nothing running) ----
await new Promise((resolve) => setTimeout(resolve, 5000));
const idle = cgroupMiB('memory.current');

// ---- API p95 ----
const queries = {
  'list (newest 50)': 'invoices?limit=50',
  'list overdue': 'invoices?status=OVERDUE&limit=50',
  'search customer': 'invoices?q=kunde%2012&limit=50',
  'sort by amount': 'invoices?sort=amount&order=desc&limit=50',
  'dashboard summary': 'invoices/summary',
  'customer search': 'customers?q=mu&limit=20',
};
const results = {};
for (const [name, path] of Object.entries(queries)) {
  const times = [];
  for (let i = 0; i < 40; i++) times.push(await timed(() => call('GET', path)));
  results[name] = p95(times);
}

// ---- PDF: 3-page invoice ----
const draft = await call('POST', 'invoices', { customerId: customer.id });
const positions = Array.from({ length: 45 }, (_, i) => ({
  type: i % 3 ? 'WORK' : 'MATERIAL',
  description: `Position ${i + 1}: Wand spachteln, schleifen und streichen\nRaum ${i + 1}`,
  quantityMilli: 1000 + i * 250,
  unitCode: 'MTK',
  unitPriceCents: 3250 + i,
  vatRate: 19,
}));
const saved = await call('PUT', `invoices/${draft.id}`, {
  ...Object.fromEntries(
    [
      'version',
      'customerId',
      'documentLanguage',
      'invoiceDate',
      'serviceDateFrom',
      'serviceDateTo',
      'paymentTermDays',
      'siteAddress',
      'subject',
      'introText',
      'closingText',
    ].map((k) => [k, draft[k]]),
  ),
  positions,
});
const pdfTimes = [];
for (let i = 0; i < 8; i++)
  pdfTimes.push(await timed(() => call('GET', `invoices/${saved.id}/preview`)));
await call('DELETE', `invoices/${saved.id}`);
const peak = cgroupMiB('memory.peak');

const report = {
  'API p95 (ms)': Object.fromEntries(Object.entries(results).map(([k, v]) => [k, Math.round(v)])),
  'PDF 3 pages (ms)': { p95: Math.round(p95(pdfTimes)), max: Math.round(Math.max(...pdfTimes)) },
  'memory (MiB)': { idle: Math.round(idle), peak: Math.round(peak) },
};
console.log(JSON.stringify(report, null, 2));
