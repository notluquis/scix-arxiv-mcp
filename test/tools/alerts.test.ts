import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stateDir } from '../../src/cache.js';
import {
  handleArxivCheckAlerts, handleArxivListWatches, handleArxivUnwatchTopic, handleArxivWatchTopic, toArxivMinute,
} from '../../src/tools/alerts.js';
import { connect } from '../helpers/harness.js';
import { makeAtomFeed } from '../helpers/arxivFixtures.js';

interface Row { id: string; published: string; categories?: string[] }

/**
 * arXiv stand-in: honours the submittedDate minute range (inclusive), sortOrder and max_results of the
 * real request URL, so ordering and boundary behaviour are exercised, not assumed.
 */
function fakeArxiv(rows: Row[]) {
  const urls: string[] = [];
  global.fetch = vi.fn(async (u: string | URL) => {
    const url = String(u);
    urls.push(url);
    const q = decodeURIComponent(url.split('search_query=')[1]!.split('&')[0]!.replace(/\+/g, ' '));
    const range = /submittedDate:\[(\d{12}) TO (\d{12})\]/.exec(q)!;
    const order = /sortOrder=(\w+)/.exec(url)![1];
    const max = Number(/max_results=(\d+)/.exec(url)![1]);
    const hit = rows
      .filter(r => {
        const m = toArxivMinute(Date.parse(r.published));
        return m >= range[1]! && m <= range[2]!;
      })
      .sort((a, b) => Date.parse(a.published) - Date.parse(b.published) || a.id.localeCompare(b.id));
    if (order === 'descending') hit.reverse();
    const xml = makeAtomFeed(hit.slice(0, max).map(r => ({
      id: r.id, title: `T ${r.id}`, authors: ['A'], abstract: 'x', published: r.published, categories: r.categories ?? ['cs.LG'],
    })));
    return { ok: true, status: 200, headers: new Headers(), text: async () => xml, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
  return urls;
}

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const ids = (r: { structured: Record<string, unknown> }) =>
  (r.structured['results'] as { new_papers: { arxiv_id: string }[] }[]).flatMap(x => x.new_papers.map(p => p.arxiv_id));

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('arxiv_watch_topic', () => {
  it('seeds the watermark at creation, so the first check returns nothing historical', async () => {
    at('2026-10-04T12:00:00Z');
    const urls = fakeArxiv([{ id: '2610.00001', published: '2026-10-04T11:59:59Z' }]);
    await handleArxivWatchTopic({ topic: 'dark matter' });
    at('2026-10-04T12:05:00Z');
    const r = await handleArxivCheckAlerts({});
    expect(r.isError).toBeFalsy();
    expect(ids(r)).toEqual([]);
    expect(decodeURIComponent(urls[0]!)).toContain('submittedDate:[202610041200+TO+202610041205]');
  });

  it('plain-word topics are ANDed in the request, not treated as arXiv syntax', async () => {
    at('2026-10-04T12:00:00Z');
    const urls = fakeArxiv([]);
    await handleArxivWatchTopic({ topic: 'dark matter' });
    at('2026-10-04T12:05:00Z');
    await handleArxivCheckAlerts({});
    expect(decodeURIComponent(urls[0]!)).toContain('all:dark+AND+all:matter');
  });

  it('categories: kept when omitted, replaced when given, cleared by []; each reaches the query', async () => {
    at('2026-10-04T12:00:00Z');
    const urls = fakeArxiv([]);
    await handleArxivWatchTopic({ topic: 't', categories: ['cs.LG', 'stat.ML'] });
    await handleArxivWatchTopic({ topic: 't', max_results: 7 });
    await handleArxivCheckAlerts({});
    expect(decodeURIComponent(urls.at(-1)!)).toContain('cat:cs.LG+OR+cat:stat.ML');

    await handleArxivWatchTopic({ topic: 't', categories: ['astro-ph.GA'] });
    await handleArxivCheckAlerts({});
    expect(decodeURIComponent(urls.at(-1)!)).toContain('cat:astro-ph.GA');
    expect(decodeURIComponent(urls.at(-1)!)).not.toContain('cs.LG');

    const cleared = await handleArxivWatchTopic({ topic: 't', categories: [] });
    expect((cleared.structured['watch'] as { categories: string[] }).categories).toEqual([]);
    await handleArxivCheckAlerts({});
    expect(decodeURIComponent(urls.at(-1)!)).not.toContain('cat:');
  });

  it('max_results: default 10, preserved on update, replaced when given, and sent to arXiv', async () => {
    at('2026-10-04T12:00:00Z');
    const urls = fakeArxiv([]);
    const created = await handleArxivWatchTopic({ topic: 't' });
    expect((created.structured['watch'] as { max_results: number }).max_results).toBe(10);
    const kept = await handleArxivWatchTopic({ topic: 't', categories: ['cs.LG'] });
    expect((kept.structured['watch'] as { max_results: number }).max_results).toBe(10);
    const changed = await handleArxivWatchTopic({ topic: 't', max_results: 3 });
    expect((changed.structured['watch'] as { max_results: number }).max_results).toBe(3);
    expect(changed.structured['created']).toBe(false);
    await handleArxivCheckAlerts({});
    expect(urls[0]).toContain('max_results=53');
  });

  it('update preserves the watermark', async () => {
    at('2026-10-04T12:00:00Z');
    await handleArxivWatchTopic({ topic: 't' });
    at('2026-10-04T13:00:00Z');
    const r = await handleArxivWatchTopic({ topic: 't', categories: ['cs.LG'] });
    const w = r.structured['watch'] as { last_checked: string; created_at: string; updated_at: string };
    expect(w.last_checked).toBe('2026-10-04T12:00:00.000Z');
    expect(w.updated_at).toBe('2026-10-04T13:00:00.000Z');
    expect(w.created_at).toBe('2026-10-04T12:00:00.000Z');
  });
});

describe('arxiv_check_alerts draining', () => {
  const rows: Row[] = [1, 2, 3, 4, 5].map(i => ({ id: `2610.0000${i}`, published: `2026-10-04T12:0${i}:00Z` }));

  it('a full page sets more_pending; the next call continues from the advanced watermark, ascending, no skips', async () => {
    at('2026-10-04T12:00:00Z');
    const urls = fakeArxiv(rows);
    await handleArxivWatchTopic({ topic: 't', max_results: 2 });
    at('2026-10-04T13:00:00Z');

    // The stand-in returns max+50 rows, so shrink the page by making the watch's overfetch irrelevant:
    // five papers, max_results 2 -> fresh (5) > page (2) -> more_pending.
    const first = await handleArxivCheckAlerts({});
    expect(ids(first)).toEqual(['2610.00001', '2610.00002']);
    expect((first.structured['results'] as { more_pending: boolean }[])[0]!.more_pending).toBe(true);
    expect(urls[0]).toContain('sortOrder=ascending');
    expect(urls[0]).toContain('sortBy=submittedDate');

    const second = await handleArxivCheckAlerts({});
    expect(ids(second)).toEqual(['2610.00003', '2610.00004']);
    expect(decodeURIComponent(urls[1]!)).toContain('submittedDate:[202610041202+TO+'); // watermark minute, inclusive

    const third = await handleArxivCheckAlerts({});
    expect(ids(third)).toEqual(['2610.00005']);
    expect((third.structured['results'] as { more_pending: boolean }[])[0]!.more_pending).toBe(false);

    expect(ids(await handleArxivCheckAlerts({}))).toEqual([]);
  });

  it('boundary: papers in the watermark minute are neither lost nor duplicated (one per page, ties included)', async () => {
    at('2026-10-04T12:00:00Z');
    fakeArxiv([
      { id: 'A', published: '2026-10-04T12:34:10Z' },
      { id: 'B', published: '2026-10-04T12:34:10Z' }, // same second as A
      { id: 'C', published: '2026-10-04T12:34:50Z' }, // same minute, later second
      { id: 'D', published: '2026-10-04T12:35:00Z' },
    ]);
    await handleArxivWatchTopic({ topic: 't', max_results: 1 });
    at('2026-10-04T13:00:00Z');
    const got: string[] = [];
    for (let i = 0; i < 8; i++) got.push(...ids(await handleArxivCheckAlerts({})));
    expect(got).toEqual(['A', 'B', 'C', 'D']);
  });

  it('boundary: a paper from the creation minute but before creation is not reported, one after it is', async () => {
    at('2026-10-04T12:34:30Z');
    fakeArxiv([
      { id: 'before', published: '2026-10-04T12:34:10Z' },
      { id: 'after', published: '2026-10-04T12:34:40Z' },
    ]);
    await handleArxivWatchTopic({ topic: 't' });
    at('2026-10-04T12:34:55Z');
    expect(ids(await handleArxivCheckAlerts({}))).toEqual(['after']);
    expect(ids(await handleArxivCheckAlerts({}))).toEqual([]);
  });

  it('a failing watch reports its error and keeps its watermark; others still run', async () => {
    at('2026-10-04T12:00:00Z');
    await handleArxivWatchTopic({ topic: 'bad' });
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, headers: new Headers(), text: async () => '' }) as Response) as unknown as typeof fetch;
    at('2026-10-04T13:00:00Z');
    const r = await handleArxivCheckAlerts({});
    expect((r.structured['results'] as { error?: string; last_checked: string }[])[0]!.error).toMatch(/503/);
    const listed = await handleArxivListWatches({});
    expect((listed.structured['watches'] as { last_checked: string }[])[0]!.last_checked).toBe('2026-10-04T12:00:00.000Z');
  });
});

describe('arxiv_check_alerts topic filter', () => {
  it('checks only the named watch and leaves the other watermark alone', async () => {
    at('2026-10-04T12:00:00Z');
    const urls = fakeArxiv([
      { id: 'X1', published: '2026-10-04T12:10:00Z' },
    ]);
    await handleArxivWatchTopic({ topic: 'alpha' });
    await handleArxivWatchTopic({ topic: 'beta' });
    at('2026-10-04T13:00:00Z');
    const r = await handleArxivCheckAlerts({ topic: 'alpha' });
    expect(urls).toHaveLength(1);
    expect(decodeURIComponent(urls[0]!)).toContain('(all:alpha)');
    expect(ids(r)).toEqual(['X1']);
    const listed = await handleArxivListWatches({});
    const w = Object.fromEntries((listed.structured['watches'] as { topic: string; last_checked: string }[]).map(x => [x.topic, x.last_checked]));
    expect(w['alpha']).toBe('2026-10-04T12:10:00Z');
    expect(w['beta']).toBe('2026-10-04T12:00:00.000Z');
  });

  it('an unknown topic is an error, not "no new papers", and makes no request', async () => {
    const urls = fakeArxiv([]);
    await handleArxivWatchTopic({ topic: 'alpha' });
    const r = await handleArxivCheckAlerts({ topic: 'nope' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('no watch');
    expect(urls).toHaveLength(0);
  });
});

describe('persistence', () => {
  const file = () => path.join(stateDir(), 'watches.json');

  it('a corrupt file is preserved as watches.json.corrupt-<ts> and reported, never silently reset', async () => {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(file(), '{ not json');
    const r = await handleArxivListWatches({});
    expect(r.structured['warning']).toMatch(/preserved as .*watches\.json\.corrupt-\d+/);
    expect(r.text).toContain('Warning');
    const kept = fs.readdirSync(stateDir()).filter(f => f.startsWith('watches.json.corrupt-'));
    expect(kept).toHaveLength(1);
    expect(fs.readFileSync(path.join(stateDir(), kept[0]!), 'utf8')).toBe('{ not json');
    expect(fs.existsSync(file())).toBe(false);
  });

  it('a well-formed JSON file of the wrong shape is also quarantined', async () => {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify({ watches: [{ topic: 1 }] }));
    const r = await handleArxivWatchTopic({ topic: 't' });
    expect(r.structured['warning']).toBeDefined();
    expect(fs.readdirSync(stateDir()).some(f => f.startsWith('watches.json.corrupt-'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(file(), 'utf8')).watches).toHaveLength(1);
  });

  it('unwatch removes the watch; an unknown topic is an error', async () => {
    await handleArxivWatchTopic({ topic: 't' });
    expect((await handleArxivUnwatchTopic({ topic: 'nope' })).isError).toBe(true);
    const r = await handleArxivUnwatchTopic({ topic: 't' });
    expect(r.structured['removed']).toBe(true);
    expect((await handleArxivListWatches({})).structured['watches']).toEqual([]);
  });
});

describe('cross-process writers on watches.json', () => {
  const file = () => path.join(stateDir(), 'watches.json');
  const readFile = () => JSON.parse(fs.readFileSync(file(), 'utf8')).watches as { topic: string; last_checked: string; seen_at_watermark: string[] }[];

  it('a check does not drop a watch another process added, nor revive one it removed, while it fetched', async () => {
    at('2026-10-04T12:00:00Z');
    fakeArxiv([{ id: 'X1', published: '2026-10-04T12:10:00Z' }]);
    await handleArxivWatchTopic({ topic: 'alpha' });
    await handleArxivWatchTopic({ topic: 'gone' });
    const inner = global.fetch;
    global.fetch = vi.fn(async (u: string | URL) => {
      // "session B", mid-fetch: adds a watch, removes another, straight on disk
      const data = JSON.parse(fs.readFileSync(file(), 'utf8')) as { watches: Record<string, unknown>[] };
      const base = data.watches[0]!;
      data.watches = data.watches.filter(w => w['topic'] !== 'gone');
      data.watches.push({ ...base, topic: 'added-by-B', seen_at_watermark: [] });
      fs.writeFileSync(file(), JSON.stringify(data));
      return inner(u);
    }) as unknown as typeof fetch;
    at('2026-10-04T13:00:00Z');
    await handleArxivCheckAlerts({ topic: 'alpha' });
    const ws = readFile();
    expect(ws.map(w => w.topic).sort()).toEqual(['added-by-B', 'alpha']);
    expect(ws.find(w => w.topic === 'alpha')!.last_checked).toBe('2026-10-04T12:10:00Z');
  });

  it('keeps the later watermark and unions seen ids at an equal one', async () => {
    at('2026-10-04T12:00:00Z');
    fakeArxiv([{ id: 'X1', published: '2026-10-04T12:10:00Z' }]);
    await handleArxivWatchTopic({ topic: 'alpha' });
    const inner = global.fetch;
    global.fetch = vi.fn(async (u: string | URL) => {
      const data = JSON.parse(fs.readFileSync(file(), 'utf8')) as { watches: Record<string, unknown>[] };
      // "session B" reported another paper in the very same second
      data.watches[0]!['last_checked'] = '2026-10-04T12:10:00Z';
      data.watches[0]!['seen_at_watermark'] = ['OTHER'];
      fs.writeFileSync(file(), JSON.stringify(data));
      return inner(u);
    }) as unknown as typeof fetch;
    at('2026-10-04T13:00:00Z');
    await handleArxivCheckAlerts({});
    expect(readFile()[0]!.seen_at_watermark.sort()).toEqual(['OTHER', 'X1']);

    // and a watermark already ahead on disk is not moved backwards
    const data = JSON.parse(fs.readFileSync(file(), 'utf8')) as { watches: Record<string, unknown>[] };
    data.watches[0]!['last_checked'] = '2026-10-04T12:30:00Z';
    data.watches[0]!['seen_at_watermark'] = ['LATER'];
    fs.writeFileSync(file(), JSON.stringify(data));
    fakeArxiv([]);
    const inner2 = global.fetch;
    global.fetch = vi.fn(async (u: string | URL) => {
      data.watches[0]!['last_checked'] = '2026-10-04T12:40:00Z';
      data.watches[0]!['seen_at_watermark'] = ['LATEST'];
      fs.writeFileSync(file(), JSON.stringify(data));
      return inner2(u);
    }) as unknown as typeof fetch;
    await handleArxivCheckAlerts({});
    expect(readFile()[0]!.last_checked).toBe('2026-10-04T12:40:00Z');
  });

  it('writers wait for a live lock, and take over a stale one', async () => {
    fs.mkdirSync(stateDir(), { recursive: true });
    const lock = `${file()}.lock`;
    fs.writeFileSync(lock, '999999');
    setTimeout(() => fs.rmSync(lock, { force: true }), 150);
    const t0 = performance.now();
    await handleArxivWatchTopic({ topic: 'waited' });
    expect(performance.now() - t0).toBeGreaterThanOrEqual(100);
    expect(readFile().map(w => w.topic)).toEqual(['waited']);
    expect(fs.existsSync(lock)).toBe(false);

    fs.writeFileSync(lock, '999999');
    const old = new Date(Date.now() - 60_000); // Date is faked in this file; mtime must be relative to it
    fs.utimesSync(lock, old, old);
    await handleArxivWatchTopic({ topic: 'after-stale' });
    expect(readFile().map(w => w.topic)).toContain('after-stale');
    expect(fs.existsSync(lock)).toBe(false);
  });
});

describe('over the real protocol', () => {
  it('response_format json is honoured by all four tools and the structured results validate', async () => {
    const c = await connect();
    try {
      fakeArxiv([]);
      const call = async (name: string, args: Record<string, unknown>) => {
        const r = await c.client.callTool({ name, arguments: { ...args, response_format: 'json' } });
        expect(r.isError).toBeFalsy();
        return JSON.parse((r.content as { text: string }[])[0]!.text) as Record<string, unknown>;
      };
      expect((await call('arxiv_watch_topic', { topic: 'q', categories: ['cs.LG'] }))['created']).toBe(true);
      expect((await call('arxiv_list_watches', {}))['watches']).toHaveLength(1);
      expect((await call('arxiv_check_alerts', { topic: 'q' }))['total_new']).toBe(0);
      expect((await call('arxiv_unwatch_topic', { topic: 'q' }))['removed']).toBe(true);
    } finally {
      await c.close();
    }
  });
});
