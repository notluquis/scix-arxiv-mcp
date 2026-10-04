import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { UNTRUSTED_BANNER } from '../../src/content.js';
import { makeAtomFeed, PAPER_1 } from '../helpers/arxivFixtures.js';
import { connect } from '../helpers/harness.js';

const FIXTURE = readFileSync(new URL('../fixtures/arxiv_html_latexml.html', import.meta.url), 'utf8');
const ID = '2103.01231';

function res(text: string, status = 200): Response {
  return { ok: status < 300, status, headers: new Headers(), text: async () => text } as Response;
}

/** Atom for the metadata call; `arxiv` and `ar5iv` are the bodies (or a status) of the two HTML hosts. */
function mockPages(arxiv: string | number, ar5iv: string | number = 404) {
  const calls: string[] = [];
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/api/query')) return res(makeAtomFeed([PAPER_1]));
    const page = u.includes('ar5iv.labs.arxiv.org') ? ar5iv : u.includes('arxiv.org/html/') ? arxiv : undefined;
    if (page === undefined) throw new Error(`unrouted ${u}`);
    return typeof page === 'number' ? res('', page) : res(page);
  }) as typeof fetch;
  return calls;
}

const textOf = (r: { content: unknown }) => (r.content as { text: string }[])[0].text;

describe('section tools through the protocol', () => {
  let c: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => { c = await connect(); });
  afterAll(async () => { await c.close(); });
  afterEach(() => vi.restoreAllMocks());

  it('outline lists sections in fixture order, behind the banner, matching its outputSchema', async () => {
    mockPages(FIXTURE);
    const r = await c.client.callTool({ name: 'arxiv_get_paper_outline', arguments: { paper_id: ID } });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toMatch(new RegExp(`^${UNTRUSTED_BANNER.replace(/[[\]]/g, '\\$&')}`));
    const sc = r.structuredContent as { source: string; sections: { id: string; level: number; chars: number }[] };
    expect(sc.source).toBe('html');
    expect(sc.sections.map(s => s.id)).toEqual(['abstract', 'S1', 'S1.SS1', 'S1.SS2', 'S2', 'A1', 'bib']);
    expect(sc.sections.every(s => s.chars > 0)).toBe(true);
    // The structured output carries metadata only, never the section text.
    expect(JSON.stringify(sc)).not.toContain('Protoplanetary');
  });

  it('falls back to ar5iv after a 404 on arxiv.org/html', async () => {
    const calls = mockPages(404, FIXTURE);
    const r = await c.client.callTool({ name: 'arxiv_get_paper_outline', arguments: { paper_id: ID } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ source: 'ar5iv' });
    expect(calls.some(u => u.startsWith('https://ar5iv.labs.arxiv.org/html/'))).toBe(true);
  });

  it('read_paper_section: banner, TeX math in the text', async () => {
    mockPages(FIXTURE);
    const r = await c.client.callTool({ name: 'arxiv_read_paper_section', arguments: { paper_id: ID, section_id: 'S2' } });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain(UNTRUSTED_BANNER);
    expect(textOf(r)).toContain('$$M_{\\rm dust}=');
    expect(r.structuredContent).toMatchObject({ section_id: 'S2', offset: 0, next_offset: null });
  });

  it('read_paper_section: non-default max_chars and offset paginate through a long section', async () => {
    const body = Array.from({ length: 400 }, (_, i) => `w${String(i).padStart(3, '0')}`).join(' '); // 1999 chars
    const long = `<article><section id="S1" class="ltx_section"><h2 class="ltx_title ltx_title_section">Long</h2><p>${body}</p></section></article>`;
    mockPages(long);
    const first = await c.client.callTool({
      name: 'arxiv_read_paper_section', arguments: { paper_id: ID, section_id: 'S1', max_chars: 1000 },
    });
    const a = first.structuredContent as { next_offset: number; total_chars: number; returned_chars: number };
    expect(a.returned_chars).toBe(1000);
    expect(a.next_offset).toBe(1000);
    expect(a.total_chars).toBeGreaterThan(1000);
    expect(textOf(first)).toContain('offset=1000');

    const second = await c.client.callTool({
      name: 'arxiv_read_paper_section', arguments: { paper_id: ID, section_id: 'S1', offset: a.next_offset, max_chars: 1500 },
    });
    expect(second.structuredContent).toMatchObject({ offset: 1000, next_offset: null, returned_chars: a.total_chars - 1000 });
    expect(textOf(second)).toContain('w399');
    expect(textOf(second)).not.toContain('w000');
  });

  it('unknown section id is an isError result that lists the valid ids', async () => {
    mockPages(FIXTURE);
    const r = await c.client.callTool({ name: 'arxiv_read_paper_section', arguments: { paper_id: ID, section_id: 'S9' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('No section "S9"');
    expect(textOf(r)).toContain('abstract, S1, S1.SS1, S1.SS2, S2, A1, bib');
  });

  it('search_paper_text: case-insensitive, section ids and offsets usable with read_paper_section', async () => {
    mockPages(FIXTURE);
    const r = await c.client.callTool({
      name: 'arxiv_search_paper_text', arguments: { paper_id: ID, query: 'ALMA ARCHIVAL', passage_chars: 100 },
    });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain(UNTRUSTED_BANNER);
    const sc = r.structuredContent as { passages: { section_id: string; offset: number; snippet: string }[] };
    expect(sc.passages).toHaveLength(1);
    expect(sc.passages[0].section_id).toBe('S1.SS2');
    expect(sc.passages[0].snippet.toLowerCase()).toContain('alma archival');
    expect(sc.passages[0].snippet.length).toBeLessThanOrEqual(100);
    const back = await c.client.callTool({
      name: 'arxiv_read_paper_section',
      arguments: { paper_id: ID, section_id: 'S1.SS2', offset: sc.passages[0].offset },
    });
    expect(textOf(back).toLowerCase()).toContain('alma archival');
  });

  it('search_paper_text: max_passages caps the result but total_passages still counts all', async () => {
    mockPages(FIXTURE);
    const r = await c.client.callTool({
      name: 'arxiv_search_paper_text', arguments: { paper_id: ID, query: 'dust', max_passages: 1, passage_chars: 50 },
    });
    const sc = r.structuredContent as { total_passages: number; passages: unknown[] };
    expect(sc.passages).toHaveLength(1);
    expect(sc.total_passages).toBeGreaterThan(1);
  });

  it('search_paper_text: matches inside an already returned snippet are not repeated', async () => {
    mockPages(FIXTURE);
    const r = await c.client.callTool({
      name: 'arxiv_search_paper_text', arguments: { paper_id: ID, query: 'dust', max_passages: 25, passage_chars: 2000 },
    });
    const sc = r.structuredContent as { total_passages: number; passages: { section_id: string }[] };
    // every section is shorter than one 2000-char passage, so each holds at most one
    const ids = sc.passages.map(p => p.section_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['abstract', 'S1', 'S2']);
  });

  it('search_paper_text with no match says so', async () => {
    mockPages(FIXTURE);
    const r = await c.client.callTool({ name: 'arxiv_search_paper_text', arguments: { paper_id: ID, query: 'zzzzqqq' } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ total_passages: 0, passages: [] });
  });

  it('unknown paper is an isError result', async () => {
    global.fetch = vi.fn(async () => res(makeAtomFeed([]))) as typeof fetch;
    const r = await c.client.callTool({ name: 'arxiv_get_paper_outline', arguments: { paper_id: '2103.99999' } });
    expect(r.isError).toBe(true);
  });
});

describe('progress notifications', () => {
  let c: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => { c = await connect(); });
  afterAll(async () => { await c.close(); });
  afterEach(() => vi.restoreAllMocks());

  type P = { progress: number; total?: number; message?: string };
  const collect = () => {
    const seen: P[] = [];
    return { seen, onprogress: (p: P) => { seen.push(p); } };
  };

  it('a cold section read reports strictly increasing progress ending at the fallback it took', async () => {
    mockPages(404, FIXTURE);
    const { seen, onprogress } = collect();
    const r = await c.client.callTool(
      { name: 'arxiv_get_paper_outline', arguments: { paper_id: ID } }, { onprogress }
    );
    expect(r.isError).toBeFalsy();
    expect(seen.map(p => p.message)).toEqual(['Fetching paper metadata', 'Fetching arXiv HTML', 'Falling back to ar5iv']);
    const values = seen.map(p => p.progress);
    expect(values).toEqual([1, 2, 3]);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    expect(seen.every(p => p.total === 4)).toBe(true);
  });

  it('arxiv_read_paper reports progress too (metadata, HTML)', async () => {
    const html = `<html><body><article><h1>T</h1>${'<section><h2>Introduction</h2><p>Body text. </p></section>'.repeat(3)}</article></body></html>`;
    mockPages(html);
    const { seen, onprogress } = collect();
    const r = await c.client.callTool({ name: 'arxiv_read_paper', arguments: { paper_id: ID } }, { onprogress });
    expect(r.isError).toBeFalsy();
    expect(seen.map(p => p.progress)).toEqual([1, 2]);
  });

  it('without a progress token nothing is sent and the call still succeeds', async () => {
    mockPages(FIXTURE);
    const r = await c.client.callTool({ name: 'arxiv_get_paper_outline', arguments: { paper_id: ID } });
    expect(r.isError).toBeFalsy();
  });
});
