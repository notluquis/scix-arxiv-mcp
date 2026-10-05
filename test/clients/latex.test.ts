import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  LATEX_LIMITS, chooseMain, extractTexFiles, flattenLatex, parseLatexSections, stripLatexCommands,
  type LatexLimits,
} from '../../src/clients/latex.js';
import {
  createGnuLongNameEntry, createPaxEntry, makeTarArchive, tarOf, tgz,
} from '../helpers/tar.js';

const asMap = (files: Record<string, string>) => new Map(Object.entries(files));
const limits = (over: Partial<LatexLimits>): LatexLimits => ({ ...LATEX_LIMITS, ...over });

describe('extractTexFiles', () => {
  it('reads .tex members of a gzip tar and ignores the rest', () => {
    const files = extractTexFiles(tgz({ 'main.tex': 'A', 'fig.png': 'PNG', 'sec/b.tex': 'B' }));
    expect(files.map(f => f.name).sort()).toEqual(['main.tex', 'sec/b.tex']);
  });

  it('reads a GNU long-name (typeflag L) entry', () => {
    const name = `${'deep/'.repeat(30)}chapter.tex`; // > 100 bytes
    expect(name.length).toBeGreaterThan(100);
    const files = extractTexFiles(tarOf(createGnuLongNameEntry(name, 'LONG BODY')));
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe(name);
    expect(files[0].data.toString()).toBe('LONG BODY');
  });

  it('reads a pax header (typeflag x) path', () => {
    const name = `${'pax/'.repeat(40)}intro.tex`;
    const files = extractTexFiles(tarOf(createPaxEntry(name, 'PAX BODY')));
    expect(files.map(f => f.name)).toEqual([name]);
    expect(files[0].data.toString()).toBe('PAX BODY');
  });

  it('accepts a plain gzip holding one .tex (not a tar) and a bare .tex', () => {
    const tex = '\\documentclass{article}\\begin{document}Hi\\end{document}';
    expect(extractTexFiles(gzipSync(tex))).toMatchObject([{ name: 'main.tex' }]);
    expect(extractTexFiles(Buffer.from(tex))[0].data.toString()).toBe(tex);
  });

  it('a PDF-only e-print (raw or gzipped) says no LaTeX source is available', () => {
    expect(() => extractTexFiles(Buffer.from('%PDF-1.5\n...'))).toThrow('No LaTeX source available');
    expect(() => extractTexFiles(gzipSync('%PDF-1.5\n...'))).toThrow('No LaTeX source available');
  });

  it('a tar with no .tex, or gzip of non-TeX text, says no LaTeX source is available', () => {
    expect(() => extractTexFiles(tgz({ 'a.png': 'x' }))).toThrow('No LaTeX source available');
    expect(() => extractTexFiles(gzipSync('hello world'))).toThrow('No LaTeX source available');
  });

  it('drops unsafe names instead of trusting them', () => {
    const files = extractTexFiles(tgz({ '../evil.tex': 'x', '/abs.tex': 'x', 'ok.tex': 'y' }));
    expect(files.map(f => f.name)).toEqual(['ok.tex']);
  });

  it('gzip bomb: a small input that expands past the limit is refused with a limit error', () => {
    const bomb = gzipSync(Buffer.alloc(LATEX_LIMITS.maxOutputLength + 1024 * 1024)); // ~100 KB gzipped
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(() => extractTexFiles(bomb)).toThrow(/expands beyond \d+ bytes/);
  });

  it('non-default limits: too many members, an oversized member and too much total TeX are refused', () => {
    const files = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}.tex`, 'x'.repeat(100)]));
    expect(() => extractTexFiles(tgz(files), limits({ maxMembers: 4 }))).toThrow('more than 4 entries');
    expect(() => extractTexFiles(tgz(files), limits({ maxMemberBytes: 99 }))).toThrow('larger than 99 bytes');
    expect(() => extractTexFiles(tgz(files), limits({ maxTotalTexBytes: 499 }))).toThrow('exceed 499 bytes in total');
    expect(extractTexFiles(tgz(files), limits({ maxMembers: 5 }))).toHaveLength(5);
  });

  it('a truncated archive keeps the members that were complete', () => {
    const full = makeTarArchive({ 'a.tex': 'AAA', 'b.tex': 'B'.repeat(2000) });
    const cut = full.subarray(0, 512 + 512 + 512 + 600); // a.tex whole, b.tex cut off
    expect(extractTexFiles(cut).map(f => f.name)).toEqual(['a.tex']);
  });
});

describe('chooseMain', () => {
  it('prefers the file with \\begin{document}, then well-known names', () => {
    expect(chooseMain(asMap({ 'z.tex': 'big'.repeat(5000), 'intro.tex': 'x', 'ms.tex': '\\begin{document}' }))).toBe('ms.tex');
    expect(chooseMain(asMap({ 'other.tex': '\\begin{document}', 'main.tex': '\\begin{document}' }))).toBe('main.tex');
  });
});

describe('flattenLatex', () => {
  it('a 3-file \\input tree flattens in order (\\input, \\include, \\subfile; with and without .tex)', () => {
    const flat = flattenLatex(asMap({
      'main.tex': '\\begin{document}\nM1\n\\input{a}\nM2\n\\include{sec/b.tex}\nM3\n\\subfile{c}\nM4',
      'a.tex': 'A',
      'sec/b.tex': 'B \\input{c}',
      'c.tex': 'C',
    }));
    expect(flat.main).toBe('main.tex');
    expect(flat.text.replace(/\s+/g, ' ')).toBe('\\begin{document} M1 A M2 B C M3 C M4');
    expect(flat.included).toEqual(['main.tex', 'a.tex', 'sec/b.tex', 'c.tex']);
    expect(flat.unmatchedIncludes).toEqual([]);
    expect(flat.unusedFiles).toEqual([]);
  });

  it('resolves relative to the including file, then the root, and ignores case', () => {
    const flat = flattenLatex(asMap({
      'main.tex': '\\begin{document}\\input{sec/one}\\input{Shared}',
      'sec/one.tex': '[one \\input{two}]',
      'sec/two.tex': 'two',
      'shared.tex': 'S',
    }));
    expect(flat.text).toContain('[one two]');
    expect(flat.text).toContain('S');
  });

  it('a cycle a -> b -> a terminates, marks the skipped include and reports it', () => {
    const flat = flattenLatex(asMap({
      'a.tex': '\\documentclass{x}\\begin{document}A \\input{b}',
      'b.tex': 'B \\input{a}',
    }));
    expect(flat.text).toMatch(/A B % \[include of a\.tex skipped: cycle\]/);
    expect(flat.skippedIncludes).toEqual(['a.tex']);
    expect(flat.text.match(/A B/g)).toHaveLength(1); // stopped at the cycle, not at the depth limit
  });

  it('stops at the depth limit', () => {
    const files: Record<string, string> = { 'f0.tex': '\\begin{document}0 \\input{f1}' };
    for (let i = 1; i <= 30; i++) files[`f${i}.tex`] = `${i} \\input{f${i + 1}}`;
    const flat = flattenLatex(asMap(files), limits({ maxDepth: 5 }), 'f0.tex');
    expect(flat.text).toContain('4 ');
    expect(flat.text).not.toContain('6 ');
    expect(flat.text).toContain('depth limit');
    expect(flat.skippedIncludes.length).toBe(1);
  });

  it('reports includes that are not in the archive and leaves them as written; unused files too', () => {
    const flat = flattenLatex(asMap({
      'main.tex': '\\begin{document}\\input{missing} \\input{tables/t1}',
      'orphan.tex': 'never included',
    }));
    expect(flat.text).toContain('\\input{missing}');
    expect(flat.unmatchedIncludes).toEqual(['missing', 'tables/t1']);
    expect(flat.unusedFiles).toEqual(['orphan.tex']);
  });

  it('does not follow a commented-out include, nor mistake \\includegraphics for one', () => {
    const flat = flattenLatex(asMap({
      'main.tex': '\\begin{document}\n% \\input{a}\n\\includegraphics{a}\n100\\% \\input{a}\nok \\input{a}',
      'a.tex': 'INLINED',
    }));
    // only the last, uncommented one is inlined (the "100\%" line is not a comment)
    expect(flat.text.match(/INLINED/g)).toHaveLength(2);
    expect(flat.text).toContain('% \\input{a}');
    expect(flat.text).toContain('\\includegraphics{a}');
  });

  it('refuses an \\input fan-out bomb', () => {
    const files = asMap({
      'main.tex': '\\begin{document}' + '\\input{b}'.repeat(10),
      'b.tex': '\\input{c}'.repeat(10),
      'c.tex': '\\input{d}'.repeat(10),
      'd.tex': 'x'.repeat(1000),
    });
    expect(() => flattenLatex(files, limits({ maxFlatChars: 50_000 }))).toThrow('exceeds 50000 characters');
  });
});

describe('parseLatexSections', () => {
  const tex = String.raw`\documentclass{article}
\begin{document}
\begin{abstract}
We study things.
\end{abstract}
\section{Introduction}\label{sec:intro}
Intro text.
\subsection{Background}
Bg text.
\subsubsection{Details \textbf{here}}
Deep text.
\subsection*{Unnumbered note}
Note.
% \section{Commented out}
\section{Method}
Method text.
\begin{thebibliography}{9}
\bibitem{a} A.
\end{thebibliography}
\appendix
\section{Extra data}
Appendix text.
\subsection{More}
More text.
\section{Second appendix}
Two.
\end{document}`;
  const sections = parseLatexSections(tex);
  const body = (id: string) => {
    const s = sections.find(x => x.id === id)!;
    return tex.slice(s.start, s.end).trim();
  };

  it('ids: abstract, s1, s1.1, s1.1.1, s1.2, s2, then appendices A, A.1, B', () => {
    expect(sections.map(s => [s.id, s.level, s.title])).toEqual([
      ['abstract', 1, 'Abstract'],
      ['s1', 1, 'Introduction'],
      ['s1.1', 2, 'Background'],
      ['s1.1.1', 3, 'Details here'],
      ['s1.2', 2, 'Unnumbered note'],
      ['s2', 1, 'Method'],
      ['A', 1, 'Extra data'],
      ['A.1', 2, 'More'],
      ['B', 1, 'Second appendix'],
    ]);
  });

  it('a section excludes its subsections; a commented heading is not a section', () => {
    expect(body('s1')).toContain('Intro text.');
    expect(body('s1')).not.toContain('Bg text');
    expect(body('s1.1')).toBe('Bg text.');
    expect(body('s1.1.1')).toBe('Deep text.');
    expect(body('s1.2')).toContain('Note.');
    expect(sections.some(s => s.title.includes('Commented'))).toBe(false);
    expect(body('abstract')).toBe('We study things.');
  });

  it('the bibliography is cut off, and the text after it (appendix) still belongs to the appendix', () => {
    expect(body('s2')).toBe('Method text.');
    expect(body('A')).toBe('Appendix text.');
    expect(body('B')).toBe('Two.');
  });

  it('no headings: no sections', () => {
    expect(parseLatexSections('\\begin{document}just text\\end{document}')).toEqual([]);
  });
});

describe('stripLatexCommands', () => {
  it('is the readable text used by arxiv_read_paper (headings as markdown, cites dropped)', () => {
    const out = stripLatexCommands('\\section{Intro}\nSee \\cite{x} and \\textbf{bold} with $a^2$.');
    expect(out).toContain('# Intro');
    expect(out).toContain('bold');
    expect(out).toContain('$a^2$');
    expect(out).not.toContain('cite');
  });
});


describe('comment detection is linear', () => {
  it('a ~1 MB single-line source with many \\section and \\input finishes under 1 s', () => {
    const unit = '\\section{a}\\input{x}';
    const big = unit.repeat(Math.ceil(1_000_000 / unit.length));
    const t0 = performance.now();
    parseLatexSections(big);
    flattenLatex(asMap({ 'main.tex': `\\documentclass{x}\\begin{document}${big}\\end{document}` }));
    expect(performance.now() - t0).toBeLessThan(1000);
  }, 120_000);

  it('keeps escaped \\% and comment semantics when state is carried forward', () => {
    const t = '100\\% \\section{Real}\n% \\section{Gone} 50\\% \\section{AlsoGone}\n\\section{Back}';
    expect(parseLatexSections(t).map(s => s.title)).toEqual(['Real', 'Back']);
  });
});
