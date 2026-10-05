import { REQUEST_TIMEOUT } from './config.js';
export const ARXIV_MIN_INTERVAL_MS = 3000;
export const S2_MIN_INTERVAL_MS = 1000;
export const MAX_WAIT_MS = 60_000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;
/** Test hook: SCIX_ARXIV_RATE_SCALE=0 removes every wait (read per call, not at import). */
export function rateScale() {
    const n = Number(process.env.SCIX_ARXIV_RATE_SCALE ?? 1);
    return Number.isFinite(n) && n >= 0 ? n : 1;
}
const defaultSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/** Promise-chain mutex: calls run one at a time, at least `intervalMs * scale` apart. */
export function createLimiter(intervalMs, deps = {}) {
    const now = deps.now ?? (() => Date.now());
    const sleep = deps.sleep ?? defaultSleep;
    let tail = Promise.resolve();
    let last = -Infinity;
    return () => {
        const run = tail.then(async () => {
            // Clamped to one interval: a clock stepped backwards must not stall the queue.
            const gap = intervalMs * rateScale();
            const wait = Math.min(gap, Math.max(0, last + gap - now()));
            if (wait > 0)
                await sleep(wait);
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
export function limiterFor(url) {
    const host = new URL(url).hostname;
    if (host === 'arxiv.org' || host.endsWith('.arxiv.org'))
        return arxivLimiter;
    if (host === 'semanticscholar.org' || host.endsWith('.semanticscholar.org'))
        return s2Limiter;
    return undefined;
}
/** Milliseconds the server asked us to wait, or undefined. */
function requestedWaitMs(res, nowMs) {
    const retryAfter = res.headers?.get('retry-after');
    if (retryAfter) {
        const secs = Number(retryAfter);
        if (Number.isFinite(secs))
            return Math.max(0, secs * 1000);
        const date = Date.parse(retryAfter);
        if (!Number.isNaN(date))
            return Math.max(0, date - nowMs);
    }
    // ADS sends X-RateLimit-Reset (epoch seconds, daily quota) on EVERY response: only a 429 means "wait for it".
    const reset = res.status === 429 ? Number(res.headers?.get('x-ratelimit-reset')) : 0;
    if (reset > 0)
        return Math.max(0, reset * 1000 - nowMs);
    return undefined;
}
async function enforceMaxBytes(res, maxBytes, url) {
    const tooBig = () => new Error(`Response from ${new URL(url).hostname} exceeds ${maxBytes} bytes; refusing to download it.`);
    const declared = Number(res.headers?.get('content-length'));
    if (declared > maxBytes) {
        await res.body?.cancel().catch(() => undefined);
        throw tooBig();
    }
    if (!res.body)
        return res;
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
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
export async function fetchWithPolicy(url, init = {}, opts = {}) {
    const method = (init.method ?? 'GET').toUpperCase();
    const idempotent = opts.idempotent ?? (method === 'GET' || method === 'HEAD');
    const retries = opts.retries ?? 3;
    const retryOn = idempotent ? (opts.retryOn ?? [429, 503]) : [429];
    const limiter = opts.limiter ?? limiterFor(url);
    const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT;
    for (let attempt = 0;; attempt++) {
        if (limiter)
            await limiter();
        const timeout = AbortSignal.timeout(timeoutMs);
        const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
        let res;
        try {
            res = await fetch(url, { ...init, signal });
        }
        catch (e) {
            // A network error on an idempotent request is retried; a mutation may have reached the
            // server, and a caller abort means stop.
            if (!idempotent || init.signal?.aborted || attempt >= retries)
                throw e;
            const wait = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt * (1 + Math.random() * 0.25)) * rateScale();
            if (wait > 0)
                await defaultSleep(wait);
            continue;
        }
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
        if (scaled > 0)
            await defaultSleep(scaled);
    }
}
