import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheDir, cached, stateDir } from '../src/cache.js';
import { arxivReadPaper } from '../src/clients/arxiv.js';
import { makeAtomFeed, PAPER_1 } from './helpers/arxivFixtures.js';

const originalFetch = global.fetch;
const originalCacheHome = process.env.XDG_CACHE_HOME;

afterEach(() => {
  process.env.XDG_CACHE_HOME = originalCacheHome;
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('cached', () => {
  it('a hit does not call produce', async () => {
    const produce = vi.fn(async () => ({ a: 1 }));
    expect(await cached('k', 'key', 1000, produce)).toEqual({ a: 1 });
    expect(await cached('k', 'key', 1000, produce)).toEqual({ a: 1 });
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('an expired entry is produced again', async () => {
    const produce = vi.fn(async () => 'v');
    await cached('k', 'key', 1000, produce);
    const file = path.join(cacheDir(), 'k', fs.readdirSync(path.join(cacheDir(), 'k'))[0]!);
    const old = new Date(Date.now() - 5000);
    fs.utimesSync(file, old, old);
    await cached('k', 'key', 1000, produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('keys are isolated by kind and key', async () => {
    const produce = vi.fn(async () => 'v');
    await cached('a', 'key', 1000, produce);
    await cached('b', 'key', 1000, produce);
    await cached('a', 'other', 1000, produce);
    expect(produce).toHaveBeenCalledTimes(3);
  });

  it('never stores null, and leaves no temp file behind', async () => {
    const produce = vi.fn(async () => null);
    await cached('k', 'key', 1000, produce);
    await cached('k', 'key', 1000, produce);
    expect(produce).toHaveBeenCalledTimes(2);
    await cached('k', 'full', 1000, async () => 'x');
    expect(fs.readdirSync(path.join(cacheDir(), 'k')).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });

  it('survives an unwritable cache dir: logs to stderr and still returns the value', async () => {
    const blocker = path.join(os.tmpdir(), `scix-arxiv-blocker-${process.pid}`);
    fs.writeFileSync(blocker, 'a file where a directory is needed');
    process.env.XDG_CACHE_HOME = path.join(blocker, 'nested');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const produce = vi.fn(async () => 'still works');
      expect(await cached('k', 'key', 1000, produce)).toBe('still works');
      expect(await cached('k', 'key', 1000, produce)).toBe('still works');
      expect(produce).toHaveBeenCalledTimes(2);
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('cache write failed'));
    } finally {
      fs.rmSync(blocker, { force: true });
    }
  });

  it('uses XDG paths, with a home fallback', () => {
    expect(cacheDir()).toBe(path.join(process.env.XDG_CACHE_HOME!, 'scix-arxiv-mcp'));
    expect(stateDir()).toBe(path.join(process.env.XDG_STATE_HOME!, 'scix-arxiv-mcp'));
    delete process.env.XDG_CACHE_HOME;
    expect(cacheDir()).toBe(path.join(os.homedir(), '.cache', 'scix-arxiv-mcp'));
  });
});

describe('arxivReadPaper caching', () => {
  const html = `<html><body><article><h1>T</h1><section><h2>Introduction</h2><p>${'Body text. '.repeat(400)}</p></section></article></body></html>`;

  function stub() {
    const mock = vi.fn(async (url: string) => {
      const u = String(url);
      const body = u.includes('export.arxiv.org')
        ? makeAtomFeed([{ id: '2103.01231', title: PAPER_1.title, authors: PAPER_1.authors, abstract: PAPER_1.abstract }])
        : html;
      return new Response(body, { status: 200 });
    });
    global.fetch = mock as unknown as typeof fetch;
    return mock;
  }
  const htmlCalls = (m: ReturnType<typeof stub>) => m.mock.calls.filter(([u]) => String(u).includes('/html/')).length;

  it('second read of the same paper does not refetch the HTML (metadata is still fetched)', async () => {
    const mock = stub();
    const first = await arxivReadPaper('2103.01231v1', 'html');
    const second = await arxivReadPaper('2103.01231v1', 'html');
    expect(second.content).toBe(first.content);
    expect(htmlCalls(mock)).toBe(1);
    expect(mock.mock.calls.filter(([u]) => String(u).includes('export.arxiv.org')).length).toBe(2);
  });

  it('versioned and unversioned ids are cached separately', async () => {
    const mock = stub();
    await arxivReadPaper('2103.01231v1', 'html');
    await arxivReadPaper('2103.01231', 'html');
    expect(htmlCalls(mock)).toBe(2);
  });
});
