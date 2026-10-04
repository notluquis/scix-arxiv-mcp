import { SCIX_API_BASE, getScixApiKey } from '../config.js';
import { fetchWithPolicy } from '../http.js';

/** `idempotent: true` marks a read-only POST (e.g. a batch lookup) as safe to retry on 503. */
export interface WriteOptions {
  idempotent?: boolean;
}

export class ScixClient {
  private readonly apiKey: string;

  constructor() {
    this.apiKey = getScixApiKey();
  }

  async get(endpoint: string, params?: Record<string, unknown>): Promise<unknown> {
    const url = new URL(`${SCIX_API_BASE}/${endpoint}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return this.#json(await this.#request(url.toString(), { method: 'GET' }));
  }

  async post(endpoint: string, body: unknown, opts: WriteOptions = {}): Promise<unknown> {
    return this.#json(await this.#request(`${SCIX_API_BASE}/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, opts.idempotent ?? false));
  }

  /** POST whose response body is not guaranteed to be JSON (e.g. a CSV export). */
  async postText(endpoint: string, body: unknown, opts: WriteOptions = {}): Promise<string> {
    const res = await this.#request(`${SCIX_API_BASE}/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, opts.idempotent ?? false);
    return res.text();
  }

  async put(endpoint: string, body: unknown): Promise<unknown> {
    return this.#json(await this.#request(`${SCIX_API_BASE}/${endpoint}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }));
  }

  async delete(endpoint: string): Promise<unknown> {
    return this.#json(await this.#request(`${SCIX_API_BASE}/${endpoint}`, { method: 'DELETE' }));
  }

  async #json(res: Response): Promise<unknown> {
    // DELETE may return 204 No Content
    if (res.status === 204) return {};
    return res.json();
  }

  async #request(url: string, init: RequestInit, idempotent = init.method === 'GET'): Promise<Response> {
    const res = await fetchWithPolicy(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    }, { idempotent });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`SciX API error ${res.status}: ${text}`);
    }
    return res;
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────
// Re-used across requests to avoid re-reading env and re-allocating on every
// incoming MCP call. Safe because ScixClient holds no per-request state.

let _client: ScixClient | undefined;

export function getScixClient(): ScixClient {
  if (!_client) _client = new ScixClient();
  return _client;
}
