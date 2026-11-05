// Cliente mínimo da REST API do Workday (OAuth 2.0 via refresh_token).
import { config, endpoints } from './config.js';

let cached = null; // { token, expiresAt }

export class WorkdayError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function getAccessToken({ force = false } = {}) {
  if (!force && cached && Date.now() < cached.expiresAt) return cached.token;

  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const res = await fetch(endpoints.token, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: config.refreshToken }),
  });
  const text = await res.text();
  if (!res.ok) throw new WorkdayError(`Falha ao obter token (HTTP ${res.status}): ${text}`, res.status, text);

  const json = JSON.parse(text);
  const ttl = Number(json.expires_in ?? 3600);
  cached = { token: json.access_token, expiresAt: Date.now() + Math.max(ttl - 60, 30) * 1000 };
  return cached.token;
}

// GET em /ccx/api/<path>. Renova o token uma vez se receber 401.
export async function get(path, params = {}) {
  const url = new URL(endpoints.rest(path));
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken({ force: attempt > 0 });
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (res.status === 401 && attempt === 0) continue;
    const text = await res.text();
    if (!res.ok) throw new WorkdayError(`GET ${url.pathname} → HTTP ${res.status}: ${text.slice(0, 500)}`, res.status, text);
    return JSON.parse(text);
  }
}

// Itera todas as páginas de uma coleção ({ data, total }) usando limit/offset.
export async function* paginate(path, params = {}, pageSize = 100) {
  for (let offset = 0; ; offset += pageSize) {
    const page = await get(path, { ...params, limit: pageSize, offset });
    const data = page.data ?? [];
    yield* data;
    if (data.length < pageSize || offset + data.length >= (page.total ?? Infinity)) return;
  }
}
