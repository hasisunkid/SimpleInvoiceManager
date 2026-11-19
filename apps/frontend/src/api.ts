/**
 * All API calls use paths relative to the document (no leading slash), so they resolve
 * under the Home Assistant ingress path as well as at "/" (AR-13).
 */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`api/${path}`, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`GET api/${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

export interface Health {
  status: 'ok' | 'error';
  database: boolean;
  migrations: { applied: number; pending: number };
}
