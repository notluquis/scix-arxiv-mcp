import { vi } from 'vitest';

export interface MockFetchOptions {
  status?: number;
  statusText?: string;
  body?: any;
  headers?: Record<string, string>;
  delay?: number;
  shouldAbort?: boolean;
}

/**
 * Creates a mock fetch function with configurable responses
 */
export function createMockFetch(options: MockFetchOptions = {}) {
  const {
    status = 200,
    statusText = 'OK',
    body = {},
    headers = {},
    delay = 0,
    shouldAbort = false
  } = options;

  return vi.fn(async (url: string, init?: RequestInit) => {
    // Simulate network delay
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Simulate abort
    if (shouldAbort || init?.signal?.aborted) {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }

    // Check if abort signal triggers during delay
    if (init?.signal) {
      init.signal.addEventListener('abort', () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      });
    }

    const response = {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      headers: new Map(Object.entries({
        'content-type': 'application/json',
        ...headers
      })),
      json: async () => body,
      text: async () => JSON.stringify(body),
      blob: async () => new Blob([JSON.stringify(body)]),
      arrayBuffer: async () => new ArrayBuffer(0),
      formData: async () => new FormData(),
      clone: () => response
    };

    return response as Response;
  });
}

/**
 * Sets up global fetch mock with default successful response
 */
export function setupMockFetch(options: MockFetchOptions = {}) {
  const mockFetch = createMockFetch(options);
  global.fetch = mockFetch as any;
  return mockFetch;
}

/**
 * Creates a mock fetch that throws a network error
 */
export function createNetworkErrorFetch() {
  return vi.fn(async () => {
    throw new Error('Network error');
  });
}

/**
 * Creates a mock fetch that simulates timeout
 */
export function createTimeoutFetch(timeoutMs: number = 100) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    return new Promise((_, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      }, timeoutMs);

      // If signal is provided, listen for abort
      if (init?.signal) {
        init.signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }
    });
  });
}

/**
 * Restores the original fetch implementation
 */
export function restoreFetch() {
  vi.restoreAllMocks();
}

/**
 * Helper to verify fetch was called with correct parameters
 */
export function verifyFetchCall(
  mockFetch: any,
  expectedUrl: string,
  expectedInit?: Partial<RequestInit>
) {
  const calls = mockFetch.mock.calls;
  const matchingCall = calls.find((call: any) => {
    const [url, init] = call;
    if (!url.includes(expectedUrl)) return false;
    if (!expectedInit) return true;

    if (expectedInit.method && init?.method !== expectedInit.method) return false;
    if (expectedInit.headers) {
      const headers = init?.headers as Record<string, string>;
      for (const [key, value] of Object.entries(expectedInit.headers)) {
        if (headers[key] !== value) return false;
      }
    }
    return true;
  });

  return matchingCall !== undefined;
}
