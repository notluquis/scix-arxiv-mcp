import { REQUEST_TIMEOUT } from './config.js';

export const ARXIV_MIN_INTERVAL_MS = 3000;
export const S2_MIN_INTERVAL_MS = 1000;
export const MAX_WAIT_MS = 60_000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;

/** Test hook: SCIX_ARXIV_RATE_SCALE=0 removes every wait (read per call, not at import). */
export function rateScale(): number {
  const n = Number(process.env.SCIX_ARXIV_RATE_SCALE ?? 1);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export type Limiter = () => Promise<void>;

/** Promise-chain mutex: calls run one at a time, at least `intervalMs * scale` apart. */
export function createLimiter(
  intervalMs: number,
  deps: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}
): Limiter {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;
  let tail: Promise<void> = Promise.resolve();
  let last = -Infinity;
  return () => {
    const run = tail.then(async () => {
      // Clamped to one interval: a clock stepped backwards must not stall the queue.
      const gap = intervalMs * rateScale();
      const wait = Math.min(gap, Math.max(0, last + gap - now()));
      if (wait > 0) await sleep(wait);
      last = now();
    });
    tail = run.catch(() => undefined);
    return run;
  };
}

// Module-scope singletons: never create these inside buildServer (the factory runs per request).
// ponytail: per-process limiter; N sessions = N x rate. Upgrade: lockfile in cacheDir()
export const arxivLimiter = createLimiter(ARXIV_MIN_INTERVAL_MS);
export const s2Limiter = createLimiter(S2_MIN_INTERVAL_MS);

/** One limiter for every arxiv.org host (export., www., ar5iv.labs.); S2 has its own; ADS has none. */
export function limiterFor(url: string): Limiter | undefined {
  const host = new URL(url).hostname;
  if (host === 'arxiv.org' || host.endsWith('.arxiv.org')) return arxivLimiter;
  if (host === 'semanticscholar.org' || host.endsWith('.semanticscholar.org')) return s2Limiter;
  return undefined;
}

export interface PolicyOptions {
  limiter?: Limiter;
  retries?: number;
  retryOn?: number[];
  /** Safe to repeat? Non-idempotent requests (mutations) only retry on 429. Default: GET/HEAD. */
  idempotent?: boolean;
  /** Abort when content-length, or the streamed body, exceeds this many bytes. */
  maxBytes?: number;
  timeoutMs?: number;
}

/** Milliseconds the server asked us to wait, or undefined. */
function requestedWaitMs(res: Response, nowMs: number): number | undefined {
  const retryAfter = res.headers?.get('retry-after');
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - nowMs);
  }
  const reset = Number(res.headers?.get('x-ratelimit-reset')); // ADS: epoch seconds
  if (reset > 0) return Math.max(0, reset * 1000 - nowMs);
  return undefined;
}

async function enforceMaxBytes(res: Response, maxBytes: number, url: string): Promise<Response> {
  const tooBig = () => new Error(`Response from ${new URL(url).hostname} exceeds ${maxBytes} bytes; refusing to download it.`);
  const declared = Number(res.headers?.get('content-length'));
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw tooBig();
  }
  if (!res.body) return res;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooBig();
    }
    chunks.push(value);
  }
  return new Response(Buffer.concat(chunks), { status: res.status, statusText: res.statusText, headers: res.headers });
}

/**
 * The only way src/ talks to the network: rate limit, per-attempt timeout, Retry-After-aware
 * retries. Returns the final response even when it is a non-ok status; callers check `ok`.
 */
export async function fetchWithPolicy(
  url: string,
  init: RequestInit = {},
  opts: PolicyOptions = {}
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const idempotent = opts.idempotent ?? (method === 'GET' || method === 'HEAD');
  const retries = opts.retries ?? 3;
  const retryOn = idempotent ? (opts.retryOn ?? [429, 503]) : [429];
  const limiter = opts.limiter ?? limiterFor(url);
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT;

  for (let attempt = 0; ; attempt++) {
    if (limiter) await limiter();
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const res = await fetch(url, { ...init, signal });

    if (!retryOn.includes(res.status) || attempt >= retries) {
      return opts.maxBytes !== undefined && res.ok ? enforceMaxBytes(res, opts.maxBytes, url) : res;
    }

    const asked = requestedWaitMs(res, Date.now());
    await res.body?.cancel().catch(() => undefined);
    const wait = asked ?? Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt * (1 + Math.random() * 0.25));
    if (wait > MAX_WAIT_MS) {
      const when = new Date(Date.now() + wait).toISOString();
      throw new Error(`${new URL(url).hostname} asked to wait ${Math.ceil(wait / 1000)}s (HTTP ${res.status}); retry after ${when}.`);
    }
    const scaled = wait * rateScale();
    if (scaled > 0) await defaultSleep(scaled);
  }
}
