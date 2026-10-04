import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LATEX_LIMITS } from '../../src/clients/latex.js';
import { UNTRUSTED_BANNER } from '../../src/content.js';
import { makeAtomFeed, PAPER_1 } from '../helpers/arxivFixtures.js';
import { connect } from '../helpers/harness.js';
import { tgz } from '../helpers/tar.js';

const ID = '2103.01231';

const SOURCE: Record<string, string> = {
  'main.tex': String.raw`\documentclass{article}
\begin{document}
\begin{abstract}An abstract.\end{abstract}
\section{Introduction}
Intro with $x^2$.
\input{sec/method}
\appendix
\section{Tables}
Table text.
\end{document}`,
  'sec/method.tex': String.raw`\subsection{Method}
Method text ` + 'word '.repeat(600),
};

function bytesResponse(bytes: Buffer, status = 200): Response {
  return {
    ok: status < 300, status, headers: new Headers(),
    text: async () => bytes.toString('utf8'),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as Response;
}

/** Atom for metadata, the e-print for `eprint` (bytes or a status), and 404 for every HTML host. */
function mockWeb(eprint: Buffer | number) {
  const calls: string[] = [];
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/api/query')) return bytesResponse(Buffer.from(makeAtomFeed([PAPER_1])));
    if (u.includes('/e-print/')) return typeof eprint === 'number' ? bytesResponse(Buffer.alloc(0), eprint) : bytesResponse(eprint);
    return bytesResponse(Buffer.alloc(0), 404);
  }) as typeof fetch;
  return calls;
}

const textOf = (r: { content: unknown }) => (r.content as { text: string }[])[0].text;

describe('LaTeX source tools through the protocol', () => {
  let c: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => { c = await connect(); });
  afterAll(async () => { await c.close(); });
  afterEach(() => vi.restoreAllMocks());

  it('arxiv_get_paper_latex: banner, flattened source (the \\input is inlined), structured metadata', async () => {
    mockWeb(tgz(SOURCE));
    const r = await c.client.callTool({ name: 'arxiv_get_paper_latex', arguments: { paper_id: ID } });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain(UNTRUSTED_BANNER);
    expect(textOf(r)).toContain('Method text');
    expect(textOf(r)).not.toContain('\\input{sec/method}');
    expect(r.structuredContent).toMatchObject({
      arxiv_id: ID, main_file: 'main.tex', offset: 0, next_offset: null,
      included_files: ['main.tex', 'sec/method.tex'], unmatched_includes: [],
    });
  });

  it('arxiv_get_paper_latex: non-default offset and max_chars page through the source', async () => {
    mockWeb(tgz(SOURCE));
    const first = await c.client.callTool({ name: 'arxiv_get_paper_latex', arguments: { paper_id: ID, max_chars: 1000 } });
    const a = first.structuredContent as { next_offset: number; total_chars: number; returned_chars: number };
    expect(a.returned_chars).toBe(1000);
    expect(a.next_offset).toBe(1000);
    const second = await c.client.callTool({
      name: 'arxiv_get_paper_latex', arguments: { paper_id: ID, offset: a.next_offset, max_chars: 150_000 },
    });
    expect(second.structuredContent).toMatchObject({ offset: 1000, next_offset: null, returned_chars: a.total_chars - 1000 });
    expect(textOf(second)).not.toContain('\\documentclass');
  });

  it('list sections, then read one by id (offset/max_chars non-default), appendix and abstract included', async () => {
    mockWeb(tgz(SOURCE));
    const list = await c.client.callTool({ name: 'arxiv_list_latex_sections', arguments: { paper_id: ID } });
    const sc = list.structuredContent as { sections: { id: string; title: string; chars: number }[] };
    expect(sc.sections.map(s => [s.id, s.title])).toEqual([
      ['abstract', 'Abstract'], ['s1', 'Introduction'], ['s1.1', 'Method'], ['A', 'Tables'],
    ]);
    expect(textOf(list)).toContain(UNTRUSTED_BANNER);

    const sec = await c.client.callTool({
      name: 'arxiv_get_latex_section', arguments: { paper_id: ID, section_id: 's1.1', max_chars: 1000 },
    });
    expect(sec.isError).toBeFalsy();
    expect(textOf(sec)).toContain('Method text');
    const m = sec.structuredContent as { next_offset: number; total_chars: number };
    expect(m.next_offset).toBe(1000);
    const rest = await c.client.callTool({
      name: 'arxiv_get_latex_section', arguments: { paper_id: ID, section_id: 'S1.1', offset: m.next_offset },
    });
    expect(rest.structuredContent).toMatchObject({ section_id: 's1.1', next_offset: null, returned_chars: m.total_chars - 1000 });

    const app = await c.client.callTool({ name: 'arxiv_get_latex_section', arguments: { paper_id: ID, section_id: 'A' } });
    expect(textOf(app)).toContain('Table text.');
  });

  it('unknown section id is an isError result listing the valid ids', async () => {
    mockWeb(tgz(SOURCE));
    const r = await c.client.callTool({ name: 'arxiv_get_latex_section', arguments: { paper_id: ID, section_id: 'nope' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('Valid section ids: abstract, s1, s1.1, A');
  });

  it('gzip bomb: isError with the limit message, and the server keeps working afterwards', async () => {
    mockWeb(gzipSync(Buffer.alloc(LATEX_LIMITS.maxOutputLength + 1024 * 1024)));
    const r = await c.client.callTool({ name: 'arxiv_get_paper_latex', arguments: { paper_id: ID } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/expands beyond \d+ bytes/);
    mockWeb(tgz(SOURCE));
    const ok = await c.client.callTool({ name: 'arxiv_list_latex_sections', arguments: { paper_id: ID } });
    expect(ok.isError).toBeFalsy();
  });

  it('a PDF-only e-print is an isError "no LaTeX source available"', async () => {
    mockWeb(Buffer.from('%PDF-1.5\nbinary'));
    const r = await c.client.callTool({ name: 'arxiv_get_paper_latex', arguments: { paper_id: ID } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('No LaTeX source available');
  });

  it('a 404 e-print is an isError too', async () => {
    mockWeb(404);
    const r = await c.client.callTool({ name: 'arxiv_list_latex_sections', arguments: { paper_id: ID } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('HTTP 404');
  });

  it('caches the flattened source: a second tool call does not download again', async () => {
    const calls = mockWeb(tgz(SOURCE));
    await c.client.callTool({ name: 'arxiv_list_latex_sections', arguments: { paper_id: ID } });
    await c.client.callTool({ name: 'arxiv_get_latex_section', arguments: { paper_id: ID, section_id: 's1' } });
    expect(calls.filter(u => u.includes('/e-print/'))).toHaveLength(1);
  });

  it('reports strictly increasing progress', async () => {
    mockWeb(tgz(SOURCE));
    const seen: { progress: number; total?: number }[] = [];
    await c.client.callTool(
      { name: 'arxiv_get_paper_latex', arguments: { paper_id: ID } },
      { onprogress: p => { seen.push(p); } }
    );
    expect(seen.map(p => p.progress)).toEqual([1, 2]);
  });

  it('the section outline falls back to LaTeX sections when HTML and ar5iv are unavailable', async () => {
    mockWeb(tgz(SOURCE));
    const r = await c.client.callTool({ name: 'arxiv_get_paper_outline', arguments: { paper_id: ID } });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as { source: string; sections: { id: string }[] };
    expect(sc.source).toBe('latex');
    expect(sc.sections.map(s => s.id)).toEqual(['abstract', 's1', 's1.1', 'A']);
    const read = await c.client.callTool({ name: 'arxiv_read_paper_section', arguments: { paper_id: ID, section_id: 's1' } });
    expect(textOf(read)).toContain('Intro with $x^2$.');
  });
});
