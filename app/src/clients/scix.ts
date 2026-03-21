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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`SciX API error ${res.status}: ${body}`);
      }

      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async post(endpoint: string, body: unknown): Promise<unknown> {
    const url = `${SCIX_API_BASE}/${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`SciX API error ${res.status}: ${text}`);
      }

      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
