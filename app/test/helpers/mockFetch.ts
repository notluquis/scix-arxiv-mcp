import { vi } from 'vitest';

export interface MockOptions {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export function mockFetch(options: MockOptions = {}) {
  const { status = 200, body = {}, text, headers = {} } = options;

  const mock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const responseText = text ?? JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json', ...headers }),
      json: async () => body,
      text: async () => responseText,
    } as Response;
  });

  global.fetch = mock as typeof fetch;
  return mock;
}

export function mockFetchError(message = 'Network error') {
  const mock = vi.fn(async () => { throw new Error(message); });
  global.fetch = mock as typeof fetch;
  return mock;
}

export function restoreFetch() {
  vi.restoreAllMocks();
}
