// Identifier validation. Every id that arrives from tool input ends up in a URL path,
// a URL query or a Solr query, so it is validated (or quoted) before it gets there.
const NEW_STYLE = /^\d{4}\.\d{4,5}$/;
const OLD_STYLE = /^[a-z]+(?:-[a-z]+)*(?:\.[A-Za-z]{2})?\/\d{7}$/;
const URL_PREFIX = /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\//i;
/**
 * Accepts `NNNN.NNNN(N)(vN)?` and `archive(.SUBJ)?/NNNNNNN(vN)?`, with an optional
 * `arXiv:` prefix or an arxiv.org abs/pdf/html URL. Throws on anything else.
 */
export function normalizeArxivId(input) {
    let s = input.trim();
    s = s.replace(URL_PREFIX, '').replace(/^arxiv:/i, '');
    if (/^https?:\/\//i.test(input.trim()))
        s = s.replace(/\.pdf$/i, '');
    const m = /^(.*?)(v\d+)?$/.exec(s);
    const base = m?.[1] ?? '';
    const version = m?.[2];
    if (!NEW_STYLE.test(base) && !OLD_STYLE.test(base)) {
        throw new Error(`Invalid arXiv id: ${JSON.stringify(input.slice(0, 80))}. Expected e.g. "2103.01231", "2103.01231v2" or "astro-ph/0601001".`);
    }
    return version ? { base, version } : { base };
}
/** Id as used in arXiv URLs: base plus the version when one was given. */
export function arxivIdWithVersion(id) {
    return `${id.base}${id.version ?? ''}`;
}
/**
 * ADS/SciX identifier query. `scix:` ids go to `scix_id`, everything else to `identifier`;
 * `\` and `"` are escaped so the value cannot break out of the quotes.
 */
export function adsIdentifierQuery(input) {
    const value = input.trim();
    const isScixId = value.toLowerCase().startsWith('scix:');
    const field = isScixId ? 'scix_id' : 'identifier';
    const v = isScixId ? `scix:${value.slice(5)}` : value;
    return `${field}:"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
// ── URL path segments (ported from adsabs/scix-mcp src/api-path.ts) ───────────
const LIBRARY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BIBCODE_LENGTH = 200;
const PATH_DELIMITER = /[/\\?#]|[\u0000-\u001f\u007f]/;
function isDotSegment(value) {
    const decoded = value.replace(/%2e/gi, '.');
    return decoded === '.' || decoded === '..';
}
export function libraryIdSegment(value) {
    if (!LIBRARY_ID.test(value)) {
        throw new Error('Invalid library_id: expected 1-64 characters from [A-Za-z0-9_-]');
    }
    return value;
}
export function bibcodeSegment(value) {
    if (value.length === 0 || value.length > MAX_BIBCODE_LENGTH) {
        throw new Error(`Invalid bibcode: expected 1-${MAX_BIBCODE_LENGTH} characters`);
    }
    if (PATH_DELIMITER.test(value)) {
        throw new Error('Invalid bibcode: path delimiters and control characters are not allowed');
    }
    if (isDotSegment(value)) {
        throw new Error('Invalid bibcode: dot segments are not allowed');
    }
    return encodeURIComponent(value);
}
/** Quotes a value for a Solr phrase: `\` and `"` are escaped so it cannot break out of the quotes. */
export function solrPhrase(value) {
    return `"${value.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
