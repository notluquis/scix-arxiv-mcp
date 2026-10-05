// arXiv LaTeX source: bounded e-print extraction (gzip, tar, lone .tex), \input flattening and
// section parsing. Everything here works on in-memory buffers; nothing is ever written to disk
// under an archive-supplied path, and every stage has a hard limit.

import { gunzipSync } from 'node:zlib';

import { cached, TTL_UNVERSIONED_MS, TTL_VERSIONED_MS } from '../cache.js';
import { fetchWithPolicy } from '../http.js';
import { arxivIdWithVersion, normalizeArxivId } from '../ids.js';
import { normalizeText } from './arxiv_html.js';

const MB = 1024 * 1024;

export interface LatexLimits {
  /** Compressed e-print download. */
  downloadBytes: number;
  /** `gunzipSync` output cap: the gzip-bomb guard. */
  maxOutputLength: number;
  /** Entries of any type in the archive. */
  maxMembers: number;
  /** One .tex member. */
  maxMemberBytes: number;
  /** All .tex members together. */
  maxTotalTexBytes: number;
  /** \input nesting. */
  maxDepth: number;
  /** Characters read while flattening, summed over every expansion (guards \input fan-out bombs). */
  maxFlatChars: number;
}

export const LATEX_LIMITS: LatexLimits = {
  downloadBytes: 50 * MB,
  maxOutputLength: 100 * MB,
  maxMembers: 2000,
  maxMemberBytes: 10 * MB,
  maxTotalTexBytes: 50 * MB,
  maxDepth: 20,
  maxFlatChars: 50 * MB,
};

/** Unavailable, unsafe or over-limit LaTeX source. The message is meant for the tool user. */
export class LatexSourceError extends Error {}

// ── Tar ──────────────────────────────────────────────────────────────────────

export interface TexFile {
  name: string;
  data: Buffer;
}

function parseSize(header: Buffer): number {
  if (header[124] & 0x80) { // GNU base-256 for sizes beyond the octal range
    let n = header[124] & 0x7f;
    for (let i = 125; i < 136; i++) n = n * 256 + header[i];
    return n;
  }
  return Number.parseInt(header.toString('latin1', 124, 136).replace(/\0.*$/, '').trim() || '0', 8) || 0;
}

function cString(buf: Buffer, from: number, to: number): string {
  return buf.toString('utf8', from, to).replace(/\0.*$/s, '');
}

/** Pax records are `<len> <key>=<value>\n`; only `path` and `size` matter here. */
function parsePax(data: Buffer): { path?: string; size?: number } {
  const out: { path?: string; size?: number } = {};
  for (let pos = 0; pos < data.length;) {
    const sp = data.indexOf(0x20, pos);
    const len = sp === -1 ? 0 : Number.parseInt(data.toString('latin1', pos, sp), 10);
    if (!(len > 0) || pos + len > data.length) break;
    const rec = data.toString('utf8', sp + 1, pos + len - 1);
    const eq = rec.indexOf('=');
    if (eq > 0) {
      const key = rec.slice(0, eq);
      const val = rec.slice(eq + 1);
      if (key === 'path') out.path = val;
      else if (key === 'size' && /^\d+$/.test(val)) out.size = Number(val);
    }
    pos += len;
  }
  return out;
}

/** A name that is safe to treat as a relative path; undefined for absolute paths and `..`. */
export function safeName(raw: string): string | undefined {
  let n = raw.replace(/\\/g, '/');
  while (n.startsWith('./')) n = n.slice(2);
  n = n.replace(/\/+$/, '');
  if (!n || n.includes('\0') || n.startsWith('/') || n.split('/').some(p => p === '..' || p === '')) return undefined;
  return n;
}

function looksLikeTar(buf: Buffer): boolean {
  if (buf.length < 512) return false;
  if (buf.toString('latin1', 257, 262) === 'ustar') return true;
  let sum = 0; // v7 tars have no magic: validate the header checksum instead
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : buf[i];
  const stored = Number.parseInt(buf.toString('latin1', 148, 156).replace(/\0.*$/, '').trim(), 8);
  return Number.isFinite(stored) && stored === sum && sum > 0;
}

/**
 * The .tex members of a tar, enforcing the member-count and size limits. Understands GNU long
 * names (typeflag L) and pax headers (x; g is skipped). Links, devices and unsafe paths are ignored.
 */
export function parseTarTex(buffer: Buffer, limits: LatexLimits = LATEX_LIMITS): TexFile[] {
  const files = new Map<string, Buffer>();
  let members = 0;
  let totalTex = 0;
  let longName: string | undefined;
  let pax: { path?: string; size?: number } = {};

  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;
    const type = String.fromCharCode(header[156]);
    const isMeta = type === 'L' || type === 'K' || type === 'x' || type === 'g';
    let size = parseSize(header);
    if (!isMeta && pax.size !== undefined) size = pax.size;
    const start = offset + 512;
    const end = start + size;
    if (end > buffer.length) break; // truncated archive: keep what was read
    offset = start + Math.ceil(size / 512) * 512;

    if (type === 'L') { longName = cString(buffer, start, end); continue; }
    if (type === 'x') { pax = parsePax(buffer.subarray(start, end)); continue; }
    if (isMeta) continue;

    members += 1;
    if (members > limits.maxMembers) {
      throw new LatexSourceError(`The source archive has more than ${limits.maxMembers} entries; refusing to read it.`);
    }
    const prefix = header.toString('latin1', 257, 263) === 'ustar\0' ? cString(header, 345, 500) : '';
    const own = cString(header, 0, 100);
    const raw = longName ?? pax.path ?? (prefix ? `${prefix}/${own}` : own);
    longName = undefined;
    pax = {};

    if (type !== '0' && type !== '\0' && type !== '7') continue; // dirs, links, devices
    const name = safeName(raw);
    if (!name || !/\.tex$/i.test(name)) continue;
    if (size > limits.maxMemberBytes) {
      throw new LatexSourceError(`${name} is larger than ${limits.maxMemberBytes} bytes; refusing to read it.`);
    }
    totalTex += size;
    if (totalTex > limits.maxTotalTexBytes) {
      throw new LatexSourceError(`The .tex files in the archive exceed ${limits.maxTotalTexBytes} bytes in total.`);
    }
    files.set(name, buffer.subarray(start, end));
  }
  return [...files].map(([name, data]) => ({ name, data }));
}

/** .tex files of an e-print: gzip(tar), tar, gzip(single .tex) or a bare .tex. PDF-only is an error. */
export function extractTexFiles(archive: Buffer, limits: LatexLimits = LATEX_LIMITS): TexFile[] {
  const noSource = () => new LatexSourceError('No LaTeX source available: the e-print has no TeX files.');
  const pdfOnly = () => new LatexSourceError('No LaTeX source available: this paper only has a PDF e-print.');
  if (archive.toString('latin1', 0, 4) === '%PDF') throw pdfOnly();

  let data = archive;
  if (archive[0] === 0x1f && archive[1] === 0x8b) {
    try {
      data = gunzipSync(archive, { maxOutputLength: limits.maxOutputLength });
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
        throw new LatexSourceError(`The e-print expands beyond ${limits.maxOutputLength} bytes; refusing to unpack it.`);
      }
      throw new LatexSourceError('The e-print is a corrupt gzip file.');
    }
    if (data.toString('latin1', 0, 4) === '%PDF') throw pdfOnly();
  }

  if (looksLikeTar(data)) {
    const files = parseTarTex(data, limits);
    if (files.length === 0) throw noSource();
    return files;
  }
  if (data.length > limits.maxMemberBytes) {
    throw new LatexSourceError(`The TeX source is larger than ${limits.maxMemberBytes} bytes; refusing to read it.`);
  }
  const text = data.toString('utf8');
  if (!/\\(documentclass|documentstyle|begin\{document\})/.test(text)) throw noSource();
  return [{ name: 'main.tex', data }];
}

// ── Flattening ───────────────────────────────────────────────────────────────

const PREFERRED_MAIN = ['main.tex', 'paper.tex', 'manuscript.tex', 'article.tex', 'ms.tex'];

/** The root document: files with \begin{document} first, then by well-known name, root dir and size. */
export function chooseMain(files: Map<string, string>): string {
  const names = [...files.keys()];
  const withDoc = names.filter(n => /\\begin\{document\}/.test(files.get(n) ?? ''));
  const withClass = names.filter(n => /\\documentclass|\\documentstyle/.test(files.get(n) ?? ''));
  const pool = withDoc.length ? withDoc : withClass.length ? withClass : names;
  const score = (n: string): number => {
    const base = n.split('/').pop()!.toLowerCase();
    const pref = PREFERRED_MAIN.indexOf(base);
    return (pref >= 0 ? 100 - pref * 10 : 0) + (n.includes('/') ? 0 : 20) + Math.min((files.get(n)?.length ?? 0) / 1000, 30);
  };
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}

const INCLUDE_RE = /\\(input|include|subfile)(?:\s*\{([^{}]*)\}|[ \t]+([^\s{}\\%]+))/g;

function dirOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i === -1 ? '' : name.slice(0, i);
}

function joinNorm(dir: string, ref: string): string | undefined {
  const parts: string[] = [];
  for (const p of `${dir}/${ref}`.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') { if (!parts.length) return undefined; parts.pop(); } else parts.push(p);
  }
  return parts.join('/');
}

/**
 * Linear-time "is offset `at` inside a % comment?" for one text. A `%` not preceded by a backslash
 * comments out the rest of its line. State is carried forward between calls (queries normally ascend);
 * a query behind the cursor restarts from 0, so any order is correct. Rescanning from the line start
 * on every call was quadratic on single-line sources (1 MB took 32 s).
 */
function commentChecker(text: string): (at: number) => boolean {
  let pos = 0;
  let inComment = false;
  return (at: number): boolean => {
    if (at < pos) { pos = 0; inComment = false; }
    for (; pos < at; pos++) {
      const c = text.charCodeAt(pos);
      if (c === 10) inComment = false;
      else if (c === 37 && !inComment && (pos === 0 || text.charCodeAt(pos - 1) !== 92)) inComment = true;
    }
    return inComment;
  };
}

export interface Flattened {
  main: string;
  text: string;
  /** Files pulled in, root first, in expansion order. */
  included: string[];
  /** Include targets that are not in the archive (left as-is in the text). */
  unmatchedIncludes: string[];
  /** Includes skipped because they would loop back, or nest past the depth limit. */
  skippedIncludes: string[];
  /** .tex files in the archive that nothing includes. */
  unusedFiles: string[];
}

/**
 * Inline `\input`, `\include` and `\subfile` recursively from the root document. Cycles and depth
 * beyond `maxDepth` are skipped with a TeX comment marker; unknown targets are left untouched and
 * listed. Commented-out includes are ignored. Total reading is capped at `maxFlatChars`.
 */
export function flattenLatex(files: Map<string, string>, limits: LatexLimits = LATEX_LIMITS, mainName?: string): Flattened {
  const main = mainName ?? chooseMain(files);
  const lower = new Map([...files.keys()].map(n => [n.toLowerCase(), n]));
  const included: string[] = [];
  const unmatched = new Set<string>();
  const skipped = new Set<string>();
  let read = 0;

  const resolve = (ref: string, fromDir: string): string | undefined => {
    for (const base of [joinNorm(fromDir, ref), joinNorm('', ref)]) {
      if (base === undefined) continue;
      for (const cand of [base, `${base}.tex`]) {
        if (files.has(cand)) return cand;
        const ci = lower.get(cand.toLowerCase());
        if (ci) return ci;
      }
    }
    return undefined;
  };

  const expand = (name: string, stack: string[]): string => {
    const text = files.get(name) ?? '';
    read += text.length;
    if (read > limits.maxFlatChars) {
      throw new LatexSourceError(`Flattening the \\input tree exceeds ${limits.maxFlatChars} characters; refusing to continue.`);
    }
    included.push(name);
    const isCommented = commentChecker(text);
    return text.replace(INCLUDE_RE, (match: string, kind: string, braced: string | undefined, bare: string | undefined, at: number) => {
      if (isCommented(at)) return match;
      const ref = (braced ?? bare ?? '').trim();
      const target = ref ? resolve(ref, dirOf(name)) : undefined;
      if (!target) { if (ref) unmatched.add(ref); return match; }
      if (stack.includes(target) || stack.length >= limits.maxDepth) {
        skipped.add(target);
        return `% [include of ${target} skipped: ${stack.includes(target) ? 'cycle' : 'depth limit'}]`;
      }
      const body = expand(target, [...stack, target]);
      return kind === 'include' ? `\n${body}\n` : body;
    });
  };

  const text = expand(main, [main]);
  const used = new Set(included);
  return {
    main,
    text,
    included: [...used],
    unmatchedIncludes: [...unmatched],
    skippedIncludes: [...skipped],
    unusedFiles: [...files.keys()].filter(n => !used.has(n)),
  };
}

// ── Sections ─────────────────────────────────────────────────────────────────

export interface LatexSection {
  id: string;
  level: number;
  title: string;
  /** Own text range in the flattened source (subsections excluded). */
  start: number;
  end: number;
}

/** Read `{...}` starting at `open` (the index of `{`); the index after the matching brace, or -1. */
function balancedEnd(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

export function cleanLatexTitle(raw: string): string {
  return raw
    .replace(/\\label\{[^{}]*\}/g, '')
    .replace(/\\texorpdfstring\{[^{}]*\}\{([^{}]*)\}/g, '$1')
    .replace(/\\(?:textbf|textit|emph|texttt|textsc|textrm|mbox|uppercase)\{([^{}]*)\}/g, '$1')
    .replace(/\\\\|\\newline/g, ' ')
    .replace(/~/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADING_RE = /\\(appendix\b|(sub){0,2}section)(\*?)[ \t]*(?:\[[^\]]*\])?[ \t]*/g;
const BIB_RE = /\\(?:begin\{thebibliography\}|bibliography\s*\{|printbibliography\b)/g;

const appendixLetter = (n: number): string => (n >= 1 && n <= 26 ? String.fromCharCode(64 + n) : `A${n}`);

/**
 * `\section`, `\subsection`, `\subsubsection` (starred forms included: they get ids like any other,
 * the id is an address, not the printed number). Ids are s1, s1.2, s1.2.3; after `\appendix` they are
 * A, A.1, A.1.1. A section's range excludes its subsections and stops at the bibliography.
 * An `abstract` environment before the first heading is listed first.
 */
export function parseLatexSections(text: string): LatexSection[] {
  const docEnd = (() => {
    const m = /\\end\{document\}/.exec(text);
    return m ? m.index : text.length;
  })();
  const isCommented = commentChecker(text);
  const bibs = [...text.matchAll(BIB_RE)].filter(m => !isCommented(m.index)).map(m => m.index);

  interface Head { level: number; title: string; at: number; bodyStart: number; appendix: boolean }
  const heads: Head[] = [];
  let appendix = false;
  for (const m of text.matchAll(HEADING_RE)) {
    if (isCommented(m.index) || m.index >= docEnd) continue;
    if (m[1].startsWith('appendix')) { appendix = true; continue; }
    const open = m.index + m[0].length;
    if (text[open] !== '{') continue;
    const close = balancedEnd(text, open);
    if (close === -1) continue;
    heads.push({
      level: m[1].length === 7 ? 1 : m[1].startsWith('subsub') ? 3 : 2,
      title: cleanLatexTitle(text.slice(open + 1, close - 1)),
      at: m.index,
      bodyStart: close,
      appendix,
    });
  }

  const sections: LatexSection[] = [];
  const abs = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/.exec(text);
  if (abs && !isCommented(abs.index) && (heads.length === 0 || abs.index < heads[0].at)) {
    const start = abs.index + '\\begin{abstract}'.length;
    sections.push({ id: 'abstract', level: 1, title: 'Abstract', start, end: start + abs[1].length });
  }

  const body = [0, 0, 0];
  const appx = [0, 0, 0];
  heads.forEach((h, i) => {
    const c = h.appendix ? appx : body;
    c[h.level - 1] += 1;
    for (let l = h.level; l < 3; l++) c[l] = 0;
    const nums = c.slice(0, h.level);
    const id = h.appendix ? [appendixLetter(nums[0]), ...nums.slice(1)].join('.') : `s${nums.join('.')}`;
    let end = Math.min(i + 1 < heads.length ? heads[i + 1].at : docEnd, docEnd);
    const bib = bibs.find(b => b >= h.bodyStart && b < end);
    if (bib !== undefined) end = bib;
    sections.push({ id, level: h.level, title: h.title, start: h.bodyStart, end });
  });
  return sections;
}

// ── Readable text ────────────────────────────────────────────────────────────

export function stripLatexCommands(text: string): string {
  const headingMap: Record<string, string> = {
    section: '#',
    subsection: '##',
    subsubsection: '###',
    paragraph: '####',
    subparagraph: '#####',
  };

  const output = text
    .replace(/\\begin\{document\}/gi, '\n\n')
    .replace(/\\end\{document\}/gi, '\n\n')
    .replace(/\\(section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^{}]+)\}/gi, (_match, name: string, title: string) => {
      const level = headingMap[name.toLowerCase()] ?? '##';
      return `\n\n${level} ${title.trim()}\n\n`;
    })
    .replace(/\\(textbf|textit|emph|underline)\{([^{}]+)\}/gi, '$2')
    .replace(/\\(?:title|author|date)\{([^{}]+)\}/gi, '$1\n')
    .replace(/\\(?:cite|citep|citet|autocite|parencite|textcite|ref|label)\{[^{}]*\}/gi, '')
    .replace(/\\includegraphics(?:\[[^\]]*\])?\{[^{}]*\}/gi, '')
    .replace(/\\item\b/gi, '\n- ')
    .replace(/\\\\/g, '\n')
    .replace(/\\[a-zA-Z@]+(?:\[[^\]]*\])?(?:\{([^{}]*)\})?/g, (_match, arg: string) => (arg ? ` ${arg} ` : ' '))
    .replace(/(?<!\\)%.*$/gm, '')
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, math: string) => `\n\n$$${math.trim()}$$\n\n`)
    .replace(/\$(?!\s)([^$]+?)\$/g, (_match, math: string) => `$${math.trim()}$`)
    .replace(/~/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  return normalizeText(output);
}

// ── Fetch + cache ────────────────────────────────────────────────────────────

/** What is cached per paper: the flattened source and where its sections are. */
export interface FlatLatex {
  main: string;
  text: string;
  included: string[];
  unmatchedIncludes: string[];
  skippedIncludes: string[];
  unusedFiles: string[];
  sections: LatexSection[];
}

export type LatexStep = (message: string) => Promise<void>;

/** Raw TeX of one section's own text. */
export const sectionSource = (flat: FlatLatex, s: LatexSection): string => flat.text.slice(s.start, s.end).trim();

async function downloadAndFlatten(urlId: string, step: LatexStep): Promise<FlatLatex> {
  await step('Fetching LaTeX source');
  let archive: Buffer;
  try {
    const res = await fetchWithPolicy(`https://arxiv.org/e-print/${urlId}`, {}, { maxBytes: LATEX_LIMITS.downloadBytes });
    if (!res.ok) throw new LatexSourceError(`No LaTeX source available for ${urlId} (HTTP ${res.status}).`);
    archive = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof LatexSourceError) throw e;
    throw new LatexSourceError(`LaTeX source of ${urlId} could not be downloaded: ${e instanceof Error ? e.message : String(e)}`);
  }
  await step('Unpacking and flattening LaTeX source');
  const files = new Map(extractTexFiles(archive).map(f => [f.name, f.data.toString('utf8')]));
  const flat = flattenLatex(files);
  return { ...flat, sections: parseLatexSections(flat.text) };
}

/**
 * The flattened LaTeX source of a paper, cached on disk (30 days for a pinned version, 3 days for
 * "latest"). Throws {@link LatexSourceError} with a user-facing message when there is none.
 */
export async function getFlatLatex(
  paperId: string,
  step: LatexStep = async () => undefined
): Promise<{ arxivId: string; version?: string; flat: FlatLatex }> {
  const id = normalizeArxivId(paperId);
  const urlId = arxivIdWithVersion(id);
  const ttl = id.version ? TTL_VERSIONED_MS : TTL_UNVERSIONED_MS;
  const flat = await cached('latex-flat', urlId, ttl, () => downloadAndFlatten(urlId, step));
  return { arxivId: id.base, version: id.version, flat };
}
