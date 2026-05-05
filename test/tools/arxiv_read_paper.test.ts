import { describe, it, expect, afterEach, vi } from 'vitest';
import { handleArxivReadPaper } from '../../src/tools/arxiv_read_paper.js';
import { makeAtomFeed, PAPER_1 } from '../helpers/arxivFixtures.js';
import { restoreFetch } from '../helpers/mockFetch.js';

const originalFetch = global.fetch;

function createTarEntry(name: string, content: string): Buffer {
  const data = Buffer.from(content, 'utf8');
  const header = Buffer.alloc(512, 0);

  header.write(name, 0, Math.min(100, Buffer.byteLength(name)), 'utf8');
  header.write('0000777\0', 100, 'utf8');
  header.write('0000000\0', 108, 'utf8');
  header.write('0000000\0', 116, 'utf8');
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'utf8');
  header.write('00000000000\0', 136, 'utf8');
  header.write('        ', 148, 'utf8');
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 'utf8');
  header.write('00', 263, 'utf8');

  const padding = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, padding]);
}

function makeTarArchive(files: Record<string, string>): Buffer {
  const entries = Object.entries(files).map(([name, content]) => createTarEntry(name, content));
  return Buffer.concat([...entries, Buffer.alloc(1024, 0)]);
}

function makeResponse(options: { text?: string; buffer?: Buffer; status?: number }) {
  const { text = '', buffer, status = 200 } = options;
  const bytes = buffer ?? Buffer.from(text, 'utf8');

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => text,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as Response;
}

describe('handleArxivReadPaper', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    restoreFetch();
  });

  it('prefers HTML when it looks like full paper text', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/query')) {
        return makeResponse({ text: makeAtomFeed([PAPER_1]) });
      }

      if (url.includes('/html/2103.01231')) {
        return makeResponse({ text: `
          <html>
            <body>
              <article>
                <h1>Attention Is All You Need</h1>
                <section><h2>Introduction</h2><p>Transformer text from HTML.</p></section>
                <section><h2>Method</h2><p>More HTML content.</p></section>
                <section><h2>Conclusion</h2><p>Done.</p></section>
                <section><h2>References</h2><p>[1] Vaswani et al.</p></section>
              </article>
            </body>
          </html>
        ` });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const result = await handleArxivReadPaper({ paper_id: '2103.01231' });

    expect(result).toContain('Attention Is All You Need');
    expect(result).toContain('**Source:** arXiv HTML');
    expect(result).toContain('Introduction');
    expect(result).toContain('Transformer text from HTML');
  });

  it('falls back to the source archive when HTML is too short', async () => {
    const tex = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
TeX body with more substance than the abstract.
\section{Method}
Important method details.
\end{document}`;
    const archive = makeTarArchive({ 'main.tex': tex });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/query')) {
        return makeResponse({ text: makeAtomFeed([PAPER_1]) });
      }

      if (url.includes('/html/2103.01231')) {
        return makeResponse({ text: '<html><body><h1>Abstract</h1><p>Short abstract only.</p></body></html>' });
      }

      if (url.includes('/e-print/2103.01231')) {
        return makeResponse({ buffer: archive });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const result = await handleArxivReadPaper({ paper_id: '2103.01231' });

    expect(result).toContain('**Source:** arXiv source archive');
    expect(result).toContain('main.tex');
    expect(result).toContain('Introduction');
    expect(result).toContain('TeX body with more substance than the abstract');
  });
});
