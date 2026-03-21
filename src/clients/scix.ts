import { SCIX_API_BASE, REQUEST_TIMEOUT, getScixApiKey } from '../config.js';

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

    return this.#fetch(url.toString(), { method: 'GET' });
  }

  async post(endpoint: string, body: unknown): Promise<unknown> {
    return this.#fetch(`${SCIX_API_BASE}/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async put(endpoint: string, body: unknown): Promise<unknown> {
    return this.#fetch(`${SCIX_API_BASE}/${endpoint}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async delete(endpoint: string): Promise<unknown> {
    return this.#fetch(`${SCIX_API_BASE}/${endpoint}`, { method: 'DELETE' });
  }

  async #fetch(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`SciX API error ${res.status}: ${text}`);
      }

      // DELETE may return 204 No Content
      if (res.status === 204) return {};
      return res.json();
    } finally {
      clearTimeout(timer);
    }
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
