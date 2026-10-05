import fs from 'node:fs/promises';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { arxivSearch, type ArxivPaper } from '../clients/arxiv.js';
import { stateDir } from '../cache.js';
import {
  addTool, CREATE_REMOTE, notFound, READ_LOCAL, responseFormat, type ToolOut,
} from '../content.js';
import { ARXIV_ICONS } from '../icons.js';

type In<S extends z.ZodType> = Omit<z.infer<S>, 'response_format'>;

// ── State (stateDir()/watches.json) ──────────────────────────────────────────

const DEFAULT_MAX_RESULTS = 10;
/** Rows fetched beyond max_results to skip papers of the watermark minute that were already reported. */
const OVERFETCH = 50;

interface Watch {
  topic: string;
  categories: string[];
  max_results: number;
  /** Watermark: `published` of the newest paper reported so far (creation time until then). */
  last_checked: string;
  /** Ids of reported papers whose `published` equals the watermark exactly (same-second ties). */
  seen_at_watermark: string[];
  created_at: string;
  updated_at: string;
}

const watchesFile = () => path.join(stateDir(), 'watches.json');

function isWatch(w: unknown): w is Watch {
  const r = w as Partial<Watch> | null;
  return !!r && typeof r.topic === 'string' && Array.isArray(r.categories) && typeof r.max_results === 'number'
    && typeof r.last_checked === 'string' && Array.isArray(r.seen_at_watermark)
    && typeof r.created_at === 'string' && typeof r.updated_at === 'string';
}

interface Loaded { watches: Watch[]; warning?: string }

async function load(): Promise<Loaded> {
  const file = watchesFile();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { watches: [] };
    throw e;
  }
  try {
    const data = JSON.parse(raw) as { watches?: unknown };
    if (Array.isArray(data.watches) && data.watches.every(isWatch)) return { watches: data.watches };
  } catch {
    // fall through to quarantine
  }
  const moved = `${file}.corrupt-${Date.now()}`;
  await fs.rename(file, moved);
  return { watches: [], warning: `watches.json was unreadable; it was preserved as ${moved} and the watch list started empty.` };
}

/** Read-only peek for prompt completions: never quarantines or throws. */
export async function peekWatches(): Promise<{ topics: string[]; ids: string[] }> {
  try {
    const data = JSON.parse(await fs.readFile(watchesFile(), 'utf8')) as { watches?: unknown };
    const ws = Array.isArray(data.watches) ? data.watches.filter(isWatch) : [];
    return { topics: ws.map(w => w.topic), ids: [...new Set(ws.flatMap(w => w.seen_at_watermark))] };
  } catch {
    return { topics: [], ids: [] };
  }
}

async function save(watches: Watch[]): Promise<void> {
  const file = watchesFile();
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(tmp, JSON.stringify({ watches }, null, 2));
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

// Serialises read-modify-write within this process (ponytail: no cross-process lock; see cache.ts limiter note).
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

// ── Time helpers ─────────────────────────────────────────────────────────────

/** YYYYMMDDHHMM in GMT: the resolution of arXiv's submittedDate filter. */
export function toArxivMinute(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace(/[-T:]/g, '');
}

const watchOut = z.object({
  topic: z.string(), categories: z.array(z.string()), max_results: z.number(),
  last_checked: z.string(), created_at: z.string(), updated_at: z.string(),
});

function publicWatch(w: Watch) {
  return {
    topic: w.topic, categories: w.categories, max_results: w.max_results,
    last_checked: w.last_checked, created_at: w.created_at, updated_at: w.updated_at,
  };
}

const withWarning = (text: string, warning?: string) => (warning ? `${text}\n\n_Warning: ${warning}_` : text);

// ── arxiv_watch_topic ────────────────────────────────────────────────────────

export const arxivWatchTopicSchema = z.object({
  topic: z.string().min(1).max(500).describe(
    'arXiv query to watch, same syntax as arxiv_search: plain words are ANDed, use all:"phrase" for an exact phrase; ' +
    'field prefixes ti:/au:/abs:, AND/OR/ANDNOT. ' +
    'Watching an existing topic string updates that watch.'
  ),
  categories: z.array(z.string()).optional().describe(
    'Optional arXiv category filter, e.g. ["cs.LG"]. On update, omit to keep the current categories; pass [] to clear them.'
  ),
  max_results: z.number().int().min(1).max(50).optional().describe(
    `Papers returned per check (max 50; default ${DEFAULT_MAX_RESULTS} for a new watch, unchanged on update).`
  ),
  response_format: responseFormat,
});

export function handleArxivWatchTopic(input: In<typeof arxivWatchTopicSchema>): Promise<ToolOut> {
  return exclusive(async () => {
    const { watches, warning } = await load();
    const nowIso = new Date().toISOString();
    const existing = watches.find(w => w.topic === input.topic);
    let record: Watch;
    if (existing) {
      if (input.categories !== undefined) existing.categories = input.categories;
      if (input.max_results !== undefined) existing.max_results = input.max_results;
      existing.updated_at = nowIso;
      record = existing;
    } else {
      record = {
        topic: input.topic, categories: input.categories ?? [], max_results: input.max_results ?? DEFAULT_MAX_RESULTS,
        last_checked: nowIso, seen_at_watermark: [], created_at: nowIso, updated_at: nowIso,
      };
      watches.push(record);
    }
    await save(watches);

    const cats = record.categories.length ? record.categories.join(', ') : 'any';
    const text = `${existing ? 'Updated' : 'Created'} watch \`${record.topic}\` (categories: ${cats}; ${record.max_results} per check). ` +
      `Papers submitted after ${record.last_checked} will be reported by arxiv_check_alerts.`;
    return {
      text: withWarning(text, warning),
      structured: { created: !existing, watch: publicWatch(record), ...(warning ? { warning } : {}) },
    };
  });
}

// ── arxiv_check_alerts ───────────────────────────────────────────────────────

export const arxivCheckAlertsSchema = z.object({
  topic: z.string().min(1).optional().describe('Check only this watch (exact topic string). Omit to check every watch.'),
  response_format: responseFormat,
});

interface WatchResult {
  topic: string;
  new_papers: { arxiv_id: string; title: string; authors: string[]; published: string; categories: string[]; abs_url: string }[];
  more_pending: boolean;
  last_checked: string;
  error?: string;
}

const ms = (iso: string) => Date.parse(iso);

/**
 * Boundary rule (arXiv filters submittedDate by the minute, `published` carries seconds):
 * query from the watermark's minute inclusive, keep papers with published > watermark, plus
 * published == watermark whose id is not in seen_at_watermark. Nothing in the watermark minute is
 * lost or repeated, and no minute is skipped when a page is cut short.
 */
async function checkOne(w: Watch): Promise<{ result: WatchResult; changed: boolean }> {
  const mark = ms(w.last_checked);
  if (Number.isNaN(mark)) throw new Error(`stored last_checked ${JSON.stringify(w.last_checked)} is not a date`);
  const limit = w.max_results + OVERFETCH;
  const raw = await arxivSearch(w.topic, {
    maxResults: limit,
    sortBy: 'submittedDate',
    sortOrder: 'ascending',
    submittedFrom: toArxivMinute(mark),
    submittedTo: toArxivMinute(Date.now()),
    categories: w.categories,
  });

  const seen = new Set(w.seen_at_watermark);
  const fresh: ArxivPaper[] = raw.filter(p => {
    const t = ms(p.published);
    return t > mark || (t === mark && !seen.has(p.id));
  });
  const page = fresh.slice(0, w.max_results);
  const more_pending = fresh.length > page.length || raw.length >= limit;

  let changed = false;
  const newest = page.at(-1);
  if (newest) {
    const t = ms(newest.published);
    const tied = page.filter(p => ms(p.published) === t).map(p => p.id);
    w.seen_at_watermark = t === mark ? [...seen, ...tied] : tied;
    w.last_checked = newest.published;
    changed = true;
  }

  return {
    changed,
    result: {
      topic: w.topic,
      new_papers: page.map(p => ({
        arxiv_id: p.id, title: p.title, authors: p.authors, published: p.published,
        categories: p.categories, abs_url: p.absUrl,
      })),
      more_pending,
      last_checked: w.last_checked,
    },
  };
}

export function handleArxivCheckAlerts(input: In<typeof arxivCheckAlertsSchema>): Promise<ToolOut> {
  return exclusive(async () => {
    const { watches, warning } = await load();
    const targets = input.topic === undefined ? watches : watches.filter(w => w.topic === input.topic);
    if (input.topic !== undefined && targets.length === 0) {
      return notFound(withWarning(`Error: no watch for topic ${JSON.stringify(input.topic)}. Use arxiv_list_watches to see saved watches.`, warning));
    }
    if (targets.length === 0) {
      return {
        text: withWarning('No watches saved. Use arxiv_watch_topic to add one.', warning),
        structured: { results: [], total_new: 0, ...(warning ? { warning } : {}) },
      };
    }

    const results: WatchResult[] = [];
    let dirty = false;
    for (const w of targets) {
      try {
        const { result, changed } = await checkOne(w);
        results.push(result);
        dirty ||= changed;
      } catch (e) {
        results.push({
          topic: w.topic, new_papers: [], more_pending: false, last_checked: w.last_checked,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    if (dirty) await save(watches);

    const total_new = results.reduce((n, r) => n + r.new_papers.length, 0);
    let text = `# arXiv alerts\n\n${total_new} new paper(s) across ${results.length} watch(es).\n\n`;
    for (const r of results) {
      text += `## \`${r.topic}\`\n\n`;
      if (r.error) text += `Check failed: ${r.error}\n\n`;
      else if (r.new_papers.length === 0) text += 'No new papers.\n\n';
      for (const p of r.new_papers) {
        text += `- **${p.title}** (${p.published.slice(0, 16)}Z)\n  - ${p.authors[0] ?? 'Unknown'}${p.authors.length > 1 ? ' et al.' : ''}; ID: \`${p.arxiv_id}\`; ${p.categories.slice(0, 3).join(', ')}\n  - ${p.abs_url}\n`;
      }
      if (r.more_pending) text += '\n_More papers pending: call arxiv_check_alerts again to continue._\n';
      text += '\n';
    }
    return { text: withWarning(text.trimEnd(), warning), structured: { results, total_new, ...(warning ? { warning } : {}) } };
  });
}

// ── arxiv_list_watches / arxiv_unwatch_topic ─────────────────────────────────

export const arxivListWatchesSchema = z.object({ response_format: responseFormat });
export const arxivUnwatchTopicSchema = z.object({
  topic: z.string().min(1).describe('Exact topic string of the watch to remove.'),
  response_format: responseFormat,
});

export function handleArxivListWatches(_input: In<typeof arxivListWatchesSchema>): Promise<ToolOut> {
  return exclusive(async () => {
    const { watches, warning } = await load();
    let text = `# arXiv watches\n\n${watches.length} watch(es).\n\n`;
    for (const w of watches) {
      text += `- \`${w.topic}\` (categories: ${w.categories.length ? w.categories.join(', ') : 'any'}; ${w.max_results} per check; last checked ${w.last_checked})\n`;
    }
    return {
      text: withWarning(text.trimEnd(), warning),
      structured: { watches: watches.map(publicWatch), ...(warning ? { warning } : {}) },
    };
  });
}

export function handleArxivUnwatchTopic(input: In<typeof arxivUnwatchTopicSchema>): Promise<ToolOut> {
  return exclusive(async () => {
    const { watches, warning } = await load();
    const rest = watches.filter(w => w.topic !== input.topic);
    if (rest.length === watches.length) {
      return notFound(withWarning(`Error: no watch for topic ${JSON.stringify(input.topic)}.`, warning));
    }
    await save(rest);
    return {
      text: withWarning(`Removed watch \`${input.topic}\`.`, warning),
      structured: { topic: input.topic, removed: true, ...(warning ? { warning } : {}) },
    };
  });
}

// ── Registration ─────────────────────────────────────────────────────────────

const warningField = { warning: z.string().optional() };

export function registerAlertTools(server: McpServer): void {
  addTool(server, 'arxiv_watch_topic', {
    title: 'Watch an arXiv topic',
    description: 'Save or update a standing arXiv query (plain words are ANDed; use all:"phrase" for exact phrases). A new watch starts at the current time, so the first check ' +
      'does not dump history. Re-watching the same topic string updates it; omit categories to keep them, [] clears them.',
    inputSchema: arxivWatchTopicSchema,
    outputSchema: z.object({ created: z.boolean(), watch: watchOut, ...warningField }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    icons: ARXIV_ICONS,
  }, input => handleArxivWatchTopic(input));

  addTool(server, 'arxiv_check_alerts', {
    title: 'Check arXiv alerts',
    description: 'Report papers submitted since each watch last reported (oldest first), and advance its watermark. ' +
      'When a page is full, more_pending is true: call again to continue where it stopped. Omit topic to check all watches.',
    inputSchema: arxivCheckAlertsSchema,
    outputSchema: z.object({
      results: z.array(z.object({
        topic: z.string(),
        new_papers: z.array(z.object({
          arxiv_id: z.string(), title: z.string(), authors: z.array(z.string()), published: z.string(),
          categories: z.array(z.string()), abs_url: z.string(),
        })),
        more_pending: z.boolean(), last_checked: z.string(), error: z.string().optional(),
      })),
      total_new: z.number(), ...warningField,
    }),
    annotations: { ...CREATE_REMOTE, idempotentHint: false },
    icons: ARXIV_ICONS,
  }, input => handleArxivCheckAlerts(input));

  addTool(server, 'arxiv_list_watches', {
    title: 'List arXiv watches',
    description: 'List saved topic watches without checking for papers or moving any watermark.',
    inputSchema: arxivListWatchesSchema,
    outputSchema: z.object({ watches: z.array(watchOut), ...warningField }),
    annotations: READ_LOCAL,
    icons: ARXIV_ICONS,
  }, input => handleArxivListWatches(input));

  addTool(server, 'arxiv_unwatch_topic', {
    title: 'Remove an arXiv watch',
    description: 'Delete a saved topic watch by its exact topic string.',
    inputSchema: arxivUnwatchTopicSchema,
    outputSchema: z.object({ topic: z.string(), removed: z.boolean(), ...warningField }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    icons: ARXIV_ICONS,
  }, input => handleArxivUnwatchTopic(input));
}
