import { SCIX_API_BASE, getScixApiKey } from '../config.js';
import { fetchWithPolicy } from '../http.js';
/** A non-2xx ADS response. The message keeps the historical `SciX API error <status>: <body>` form. */
export class ScixApiError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`SciX API error ${status}: ${body}`);
        this.status = status;
        this.body = body;
        this.name = 'ScixApiError';
    }
}
export class ScixClient {
    apiKey;
    constructor() {
        this.apiKey = getScixApiKey();
    }
    async get(endpoint, params) {
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
    async post(endpoint, body, opts = {}) {
        return this.#json(await this.#request(`${SCIX_API_BASE}/${endpoint}`, {
            method: 'POST',
            body: JSON.stringify(body),
        }, opts.idempotent ?? false));
    }
    /** POST whose response body is not guaranteed to be JSON (e.g. a CSV export). */
    async postText(endpoint, body, opts = {}) {
        const res = await this.#request(`${SCIX_API_BASE}/${endpoint}`, {
            method: 'POST',
            body: JSON.stringify(body),
        }, opts.idempotent ?? false);
        return res.text();
    }
    async put(endpoint, body) {
        return this.#json(await this.#request(`${SCIX_API_BASE}/${endpoint}`, {
            method: 'PUT',
            body: JSON.stringify(body),
        }));
    }
    async delete(endpoint) {
        return this.#json(await this.#request(`${SCIX_API_BASE}/${endpoint}`, { method: 'DELETE' }));
    }
    async #json(res) {
        // DELETE may return 204 No Content
        if (res.status === 204)
            return {};
        return res.json();
    }
    // PUT is idempotent (an edit sets values). DELETE is not retried: biblib answers 410 to a repeated
    // DELETE, so a retry after a 503 that committed would report a false failure.
    async #request(url, init, idempotent = init.method === 'GET' || init.method === 'PUT') {
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
            throw new ScixApiError(res.status, text);
        }
        return res;
    }
}
// ── Module-level singleton ────────────────────────────────────────────────────
// Re-used across requests to avoid re-reading env and re-allocating on every
// incoming MCP call. Safe because ScixClient holds no per-request state.
let _client;
export function getScixClient() {
    if (!_client)
        _client = new ScixClient();
    return _client;
}
