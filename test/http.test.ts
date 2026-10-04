import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARXIV_MIN_INTERVAL_MS,
  S2_MIN_INTERVAL_MS,
  createLimiter,
  fetchWithPolicy,
} from '../src/http.js';

const originalFetch = global.fetch;
let epoch = 1_800_000_000_000;

function res(status: number, headers: Record<string, string> = {}, body = 'ok'): Response {
  return new Response(status === 204 ? null : body, { status, headers });
}

function stubFetch(...responses: Response[]) {
  const mock = vi.fn(async () => responses.shift() ?? res(200));
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

beforeEach(() => {
  process.env.SCIX_ARXIV_RATE_SCALE = '1';
  vi.useFakeTimers();
  epoch += 1_000_000; // the module-scope limiters keep `last`; start each test well after it
  vi.setSystemTime(epoch);
});

afterEach(() => {
  vi.useRealTimers();
  process.env.SCIX_ARXIV_RATE_SCALE = '0';
  global.fetch = originalFetch;
});

describe('rate constants', () => {
  it('pjud-style guard: arXiv asks for one request every 3 seconds', () => {
    expect(ARXIV_MIN_INTERVAL_MS).toBe(3000);
    expect(S2_MIN_INTERVAL_MS).toBe(1000);
  });
});

describe('createLimiter', () => {
  it('makes the second back-to-back call wait the full interval', async () => {
    const limit = createLimiter(3000);
    await limit();
    let second = false;
    const p = limit().then(() => { second = true; });
    await vi.advanceTimersByTimeAsync(2999);
    expect(second).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(second).toBe(true);
  });

  it('does not wait when the interval has already elapsed', async () => {
    const limit = createLimiter(3000);
    await limit();
    await vi.advanceTimersByTimeAsync(3000);
    await limit(); // resolves with no pending timer
  });

  it('a clock stepped backwards waits at most one interval', async () => {
    let t = 1_000_000;
    const waits: number[] = [];
    const limit = createLimiter(3000, { now: () => t, sleep: async ms => { waits.push(ms); } });
    await limit();
    t -= 3_600_000;
    await limit();
    expect(waits).toEqual([3000]);
  });

  it('SCIX_ARXIV_RATE_SCALE=0 removes the wait', async () => {
    process.env.SCIX_ARXIV_RATE_SCALE = '0';
    const limit = createLimiter(3000);
    await limit();
    await limit();
  });
});

describe('fetchWithPolicy limiter sharing', () => {
  it('export.arxiv.org and arxiv.org share one limiter', async () => {
    const mock = stubFetch(res(200), res(200), res(200));
    await fetchWithPolicy('https://export.arxiv.org/api/query?id_list=1');
    expect(mock).toHaveBeenCalledTimes(1);

    const second = fetchWithPolicy('https://arxiv.org/html/2103.01231');
    await vi.advanceTimersByTimeAsync(2999);
    expect(mock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(mock).toHaveBeenCalledTimes(2);

    const third = fetchWithPolicy('https://ar5iv.labs.arxiv.org/html/2103.01231');
    await vi.advanceTimersByTimeAsync(2999);
    expect(mock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await third;
  });

  it('ADS is not rate limited', async () => {
    const mock = stubFetch(res(200), res(200));
    await fetchWithPolicy('https://api.adsabs.harvard.edu/v1/search/query');
    await fetchWithPolicy('https://api.adsabs.harvard.edu/v1/search/query');
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchWithPolicy retries', () => {
  it('429 with Retry-After: 2 waits 2000 ms then succeeds', async () => {
    const mock = stubFetch(res(429, { 'retry-after': '2' }), res(200, {}, 'done'));
    const p = fetchWithPolicy('https://api.adsabs.harvard.edu/v1/x');
    await vi.advanceTimersByTimeAsync(1999);
    expect(mock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const r = await p;
    expect(mock).toHaveBeenCalledTimes(2);
    expect(await r.text()).toBe('done');
  });

  it('honours an HTTP-date Retry-After', async () => {
    const date = new Date(Date.now() + 5000).toUTCString();
    const mock = stubFetch(res(503, { 'retry-after': date }), res(200));
    const p = fetchWithPolicy('https://api.adsabs.harvard.edu/v1/x');
    await vi.advanceTimersByTimeAsync(3999);
    expect(mock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);
    await p;
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('honours ADS X-RateLimit-Reset (epoch seconds)', async () => {
    const reset = String(Math.ceil(Date.now() / 1000) + 10);
    const mock = stubFetch(res(429, { 'x-ratelimit-reset': reset }), res(200));
    const p = fetchWithPolicy('https://api.adsabs.harvard.edu/v1/x');
    await vi.advanceTimersByTimeAsync(5000);
    expect(mock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5001);
    await p;
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('fails immediately, naming when to retry, if the wait is over 60 s', async () => {
    const mock = stubFetch(res(429, { 'retry-after': '120' }));
    await expect(fetchWithPolicy('https://api.adsabs.harvard.edu/v1/x')).rejects.toThrow(/120s.*retry after 20\d\d-/);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially when no header is sent, and gives up after the retries', async () => {
    const mock = stubFetch(res(503), res(503), res(503), res(503));
    const p = fetchWithPolicy('https://api.adsabs.harvard.edu/v1/x');
    await vi.advanceTimersByTimeAsync(60_000);
    const r = await p;
    expect(mock).toHaveBeenCalledTimes(4); // 1 + 3 retries
    expect(r.status).toBe(503);
  });

  it('a POST is not retried on 503', async () => {
    const mock = stubFetch(res(503), res(200));
    const r = await fetchWithPolicy('https://api.adsabs.harvard.edu/v1/biblib/library', { method: 'POST', body: '{}' });
    expect(r.status).toBe(503);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('a POST is retried on 429', async () => {
    const mock = stubFetch(res(429, { 'retry-after': '1' }), res(200));
    const p = fetchWithPolicy('https://api.adsabs.harvard.edu/v1/biblib/library', { method: 'POST', body: '{}' });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('a read-only POST marked idempotent is retried on 503', async () => {
    const mock = stubFetch(res(503, { 'retry-after': '1' }), res(200));
    const p = fetchWithPolicy('https://api.adsabs.harvard.edu/v1/search/bigquery', { method: 'POST', body: '{}' }, { idempotent: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('does not retry other statuses', async () => {
    const mock = stubFetch(res(404));
    expect((await fetchWithPolicy('https://api.adsabs.harvard.edu/v1/x')).status).toBe(404);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchWithPolicy maxBytes', () => {
  // Body streams need real timers; the limiter is off at scale 0.
  beforeEach(() => { vi.useRealTimers(); process.env.SCIX_ARXIV_RATE_SCALE = '0'; });

  it('rejects on a declared content-length over the cap', async () => {
    stubFetch(res(200, { 'content-length': '5000' }, 'x'.repeat(10)));
    await expect(fetchWithPolicy('https://arxiv.org/pdf/1', {}, { maxBytes: 100 })).rejects.toThrow(/exceeds 100 bytes/);
  });

  it('rejects when the streamed body outgrows the cap', async () => {
    stubFetch(res(200, {}, 'x'.repeat(500)));
    await expect(fetchWithPolicy('https://arxiv.org/pdf/1', {}, { maxBytes: 100 })).rejects.toThrow(/exceeds 100 bytes/);
  });

  it('passes a body under the cap through intact', async () => {
    stubFetch(res(200, {}, 'x'.repeat(50)));
    const r = await fetchWithPolicy('https://arxiv.org/pdf/1', {}, { maxBytes: 100 });
    expect((await r.text()).length).toBe(50);
  });
});
