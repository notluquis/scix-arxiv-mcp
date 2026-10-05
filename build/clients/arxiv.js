import { PDFParse } from 'pdf-parse';
import { cached, TTL_UNVERSIONED_MS, TTL_VERSIONED_MS } from '../cache.js';
import { ARXIV_API_URL } from '../config.js';
import { fetchWithPolicy } from '../http.js';
import { extractHtmlText, htmlToText, parseSections, textToSections, tidySections, } from './arxiv_html.js';
import { getFlatLatex, stripLatexCommands } from './latex.js';
import { arxivIdWithVersion, normalizeArxivId } from '../ids.js';
export { extractHtmlText };
function parseAtomFeed(xml) {
    const papers = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    while ((match = entryRegex.exec(xml)) !== null) {
        const entry = match[1];
        const id = (/<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/.exec(entry)?.[1] ?? '')
            .trim()
            .replace(/v\d+$/, '');
        const title = (/<title[^>]*>([\s\S]*?)<\/title>/.exec(entry)?.[1] ?? '').replace(/\s+/g, ' ').trim();
        const abstract = (/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(entry)?.[1] ?? '').replace(/\s+/g, ' ').trim();
        const published = (/<published>(.*?)<\/published>/.exec(entry)?.[1] ?? '').trim();
        const updated = (/<updated>(.*?)<\/updated>/.exec(entry)?.[1] ?? '').trim();
        const authorMatches = [...entry.matchAll(/<name>(.*?)<\/name>/g)];
        const authors = authorMatches.map(m => m[1].trim());
        const categoryMatches = [...entry.matchAll(/<category[^>]+term="([^"]+)"/g)];
        const categories = categoryMatches.map(m => m[1]);
        const doi = /<link[^>]+title="doi"[^>]+href="https?:\/\/dx\.doi\.org\/([^"]+)"/.exec(entry)?.[1];
        if (!id)
            continue;
        papers.push({
            id,
            title,
            authors,
            abstract,
            published,
            updated,
            categories,
            doi,
            pdfUrl: `https://arxiv.org/pdf/${id}`,
            htmlUrl: `https://arxiv.org/html/${id}`,
            absUrl: `https://arxiv.org/abs/${id}`,
        });
    }
    return papers;
}
/**
 * Convert YYYY-MM or YYYY-MM-DD to the arXiv `submittedDate` format YYYYMMDDHHMM.
 * A month-only input maps to the first (`start`) or last (`end`) day of that month.
 */
export function toArxivDate(date, edge) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(date);
    if (!m)
        throw new Error(`Invalid date ${JSON.stringify(date)}: expected YYYY-MM or YYYY-MM-DD`);
    const year = Number(m[1]);
    const month = Number(m[2]);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = m[3] ? Number(m[3]) : edge === 'start' ? 1 : daysInMonth;
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
        throw new Error(`Invalid date ${JSON.stringify(date)}: no such calendar day`);
    }
    const ymd = `${m[1]}${m[2]}${String(day).padStart(2, '0')}`;
    return `${ymd}${edge === 'start' ? '0000' : '2359'}`;
}
/** `cs.LG`, `astro-ph`, `math.AG`, `hep-th`: anything else would be spliced into the query as syntax. */
export const ARXIV_CATEGORY = /^[a-z-]+(\.[A-Za-z-]+)?$/;
const ARXIV_SYNTAX = /["()]|\b(?:AND|OR|ANDNOT)\b|\b(?:ti|au|abs|co|jr|cat|rn|id|all|submittedDate|lastUpdatedDate):/;
/**
 * arXiv treats bare terms as OR (measured: `eclipsing binary` 54 hits vs 7 for the AND). A plain
 * natural-language query becomes `all:w1 AND all:w2`; anything using arXiv syntax passes through.
 */
export function normalizeArxivQuery(query) {
    const q = query.trim();
    if (ARXIV_SYNTAX.test(q))
        return q;
    const terms = q.split(/\s+/).map(t => t.replace(/[^\p{L}\p{N}_.+\-]/gu, '')).filter(Boolean);
    return terms.length ? terms.map(t => `all:${t}`).join(' AND ') : q;
}
/**
 * Build the full arXiv API query string, appending date and category filters
 * without letting URLSearchParams double-encode the `[` `]` `*` `+TO+` tokens
 * that the arXiv Atom API expects.
 */
export function buildArxivUrl(query, opts) {
    // Parenthesized so a user `a OR b` cannot swallow the AND-ed date/category filters.
    const parts = [`(${normalizeArxivQuery(query)})`];
    if (opts.submittedFrom && opts.submittedTo) {
        parts.push(`submittedDate:[${opts.submittedFrom} TO ${opts.submittedTo}]`);
    }
    else if (opts.dateFrom || opts.dateTo) {
        // Open ends use explicit bounds: arXiv documents only closed numeric ranges.
        const from = opts.dateFrom ? toArxivDate(opts.dateFrom, 'start') : '000101010000';
        const to = opts.dateTo ? toArxivDate(opts.dateTo, 'end') : '999912312359';
        parts.push(`submittedDate:[${from} TO ${to}]`);
    }
    if (opts.categories?.length) {
        const bad = opts.categories.find(c => !ARXIV_CATEGORY.test(c));
        if (bad !== undefined)
            throw new Error(`Invalid arXiv category ${JSON.stringify(bad)}; expected e.g. "cs.LG" or "astro-ph".`);
        const catFilter = opts.categories.map(c => `cat:${c}`).join(' OR ');
        parts.push(`(${catFilter})`);
    }
    const fullQuery = parts.join(' AND ');
    // URLSearchParams encodes brackets as %5B%5D and * as %2A — arXiv API
    // needs them literal in the query string. Build manually instead.
    const encoded = encodeURIComponent(fullQuery)
        .replace(/%5B/g, '[').replace(/%5D/g, ']')
        .replace(/%2A/g, '*').replace(/%20/g, '+');
    // A literal '+' stays %2B: turning it into '+' would make arXiv read it as a space.
    const sortBy = opts.sortBy ?? 'relevance';
    const sortOrder = opts.sortOrder ?? 'descending';
    const maxResults = opts.maxResults ?? 10;
    return `${ARXIV_API_URL}?search_query=${encoded}&max_results=${maxResults}&sortBy=${sortBy}&sortOrder=${sortOrder}`;
}
async function fetchAtom(url) {
    // Atom metadata is deliberately not cached.
    const res = await fetchWithPolicy(url);
    if (!res.ok)
        throw new Error(`arXiv API error ${res.status}`);
    return parseAtomFeed(await res.text());
}
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
export async function fetchPdfText(url) {
    const res = await fetchWithPolicy(url, {}, { maxBytes: MAX_DOWNLOAD_BYTES });
    if (!res.ok)
        throw new Error(`arXiv PDF fetch error ${res.status}`);
    const pdf = new PDFParse({ data: new Uint8Array(await res.arrayBuffer()) });
    try {
        const textResult = await pdf.getText({ lineEnforce: true });
        return textResult.text.trim();
    }
    finally {
        await pdf.destroy();
    }
}
export async function arxivSearch(query, opts = {}) {
    return fetchAtom(buildArxivUrl(query, opts));
}
export async function arxivGetPaper(paperId) {
    const { base } = normalizeArxivId(paperId);
    const url = `${ARXIV_API_URL}?id_list=${base}&max_results=1`;
    const papers = await fetchAtom(url);
    return papers[0] ?? null;
}
function looksLikeFullPaperText(text, abstract = '') {
    const compact = text.toLowerCase();
    const paragraphCount = text.split(/\n{2,}/).filter(Boolean).length;
    const minLength = Math.max(abstract.length * 6, 3000);
    return text.length >= minLength || paragraphCount >= 8 || /\b(introduction|related work|method|results|discussion|conclusion|references)\b/.test(compact);
}
const MAX_HTML_BYTES = 50 * 1024 * 1024;
/**
 * The page body, or null when the page does not exist (404/410: arXiv has no HTML for that paper).
 * Anything else (503, "asked to wait", timeout, network) throws, so a transient failure is never
 * mistaken for "no HTML" and the fallback result is not cached for days.
 */
async function fetchHtmlPage(url) {
    const res = await fetchWithPolicy(url, {}, { maxBytes: MAX_HTML_BYTES });
    if (res.status === 404 || res.status === 410)
        return null;
    if (!res.ok)
        throw new Error(`${new URL(url).hostname} answered HTTP ${res.status} for ${new URL(url).pathname}; try again later.`);
    return res.text();
}
const fetchHtmlPaper = (urlId) => fetchHtmlPage(`https://arxiv.org/html/${urlId}`);
function makeReadResult(paper, source, content, version, sourceName) {
    return { paper, source, content, sourceName, version };
}
const noStep = async () => undefined;
/**
 * Full text of a paper. `auto` tries HTML, then the LaTeX source, then the PDF, then falls
 * back to the abstract. An explicit source never falls back: it throws when unavailable.
 */
export async function arxivReadPaper(paperId, source = 'auto', step = noStep) {
    const id = normalizeArxivId(paperId);
    const urlId = arxivIdWithVersion(id);
    await step('Fetching paper metadata');
    const paper = await arxivGetPaper(id.base);
    if (!paper) {
        return { paper: null, content: '', source: 'unavailable' };
    }
    const { version } = id;
    const ttl = version ? TTL_VERSIONED_MS : TTL_UNVERSIONED_MS;
    if (source === 'auto' || source === 'html') {
        await step('Fetching arXiv HTML');
        let htmlText = null;
        try {
            htmlText = await cached('html-tex', urlId, ttl, async () => {
                const html = await fetchHtmlPaper(urlId);
                return html ? htmlToText(html) : null;
            });
        }
        catch (e) {
            if (source === 'html')
                throw e; // explicit source: surface the transient failure
            // auto: carry on to LaTeX/PDF; nothing was cached
        }
        if (htmlText !== null) {
            if (source === 'html' ? htmlText : looksLikeFullPaperText(htmlText, paper.abstract)) {
                return makeReadResult(paper, 'html', htmlText, version);
            }
        }
        if (source === 'html')
            throw new Error(`No HTML rendering available for ${urlId}. Try source="latex" or "pdf".`);
    }
    if (source === 'auto' || source === 'latex') {
        await step('Fetching LaTeX source');
        let flat;
        try {
            flat = (await getFlatLatex(urlId)).flat;
        }
        catch (e) {
            if (source === 'latex')
                throw e; // an explicit source never falls back
        }
        const texText = flat ? stripLatexCommands(flat.text) : '';
        if (flat && texText)
            return makeReadResult(paper, 'latex', texText, version, flat.main);
        if (source === 'latex')
            throw new Error(`No LaTeX source available for ${urlId}. Try source="html" or "pdf".`);
    }
    if (source === 'auto' || source === 'pdf') {
        await step('Extracting PDF text');
        const pdfText = await cached('pdf', urlId, ttl, () => fetchPdfText(`https://arxiv.org/pdf/${urlId}.pdf`));
        if (pdfText) {
            return makeReadResult(paper, 'pdf', pdfText, version);
        }
        if (source === 'pdf')
            throw new Error(`No text could be extracted from the PDF of ${urlId}.`);
    }
    return makeReadResult(paper, 'abstract', paper.abstract, version);
}
/**
 * A paper split into sections. Sources, in order: arxiv.org/html, ar5iv, the LaTeX source, then PDF text with
 * heading heuristics. The flattened result is cached; a hit skips the fetch steps.
 */
export async function arxivSectionedPaper(paperId, step = noStep) {
    const id = normalizeArxivId(paperId);
    const urlId = arxivIdWithVersion(id);
    await step('Fetching paper metadata');
    const paper = await arxivGetPaper(id.base);
    if (!paper)
        return null;
    const ttl = id.version ? TTL_VERSIONED_MS : TTL_UNVERSIONED_MS;
    const sectioned = await cached('sections', urlId, ttl, async () => {
        await step('Fetching arXiv HTML');
        const html = await fetchHtmlPaper(urlId);
        const fromHtml = html ? parseSections(html) : [];
        if (fromHtml.length > 0)
            return { source: 'html', sections: fromHtml };
        await step('Falling back to ar5iv');
        const ar5iv = await fetchHtmlPage(`https://ar5iv.labs.arxiv.org/html/${urlId}`);
        const fromAr5iv = ar5iv ? parseSections(ar5iv) : [];
        if (fromAr5iv.length > 0)
            return { source: 'ar5iv', sections: fromAr5iv };
        await step('Reading LaTeX source');
        const flat = await getFlatLatex(urlId).then(r => r.flat, () => undefined);
        if (flat && flat.sections.length > 0) {
            return {
                source: 'latex',
                sections: flat.sections.map(s => ({
                    id: s.id, level: s.level, title: s.title, text: stripLatexCommands(flat.text.slice(s.start, s.end)),
                })),
            };
        }
        await step('Extracting PDF text');
        const text = await fetchPdfText(`https://arxiv.org/pdf/${urlId}.pdf`);
        const fromPdf = textToSections(text);
        if (fromPdf.length === 0)
            throw new Error(`No section structure or text could be obtained for ${urlId}.`);
        return { source: 'pdf', sections: fromPdf };
    });
    return {
        paper, arxivId: paper.id, version: id.version,
        sectioned: { ...sectioned, sections: tidySections(sectioned.sections) },
    };
}
