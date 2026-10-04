import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stateDir } from '../src/cache.js';
import { INSTRUCTIONS } from '../src/prompts.js';
import { connect } from './helpers/harness.js';

type C = Awaited<ReturnType<typeof connect>>;
let c: C | undefined;
afterEach(async () => { await c?.close(); c = undefined; });

const completeArg = async (prompt: string, arg: string, value: string) => {
  c ??= await connect();
  return (await c.client.complete({ ref: { type: 'ref/prompt', name: prompt }, argument: { name: arg, value } })).completion.values;
};

function writeWatches(watches: unknown[]) {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(path.join(stateDir(), 'watches.json'), JSON.stringify({ watches }));
}
const watch = (topic: string, ids: string[]) => ({
  topic, categories: [], max_results: 10, last_checked: '2026-10-01T00:00:00Z', seen_at_watermark: ids,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
});

describe('prompt argument completions', () => {
  it('focus completes from the static list (the required plan check)', async () => {
    expect(await completeArg('deep_paper_analysis', 'focus', 'me')).toEqual(['methodology']);
  });

  it('optional domain (.optional() outside completable) still completes', async () => {
    expect(await completeArg('research_discovery', 'domain', 'exo')).toEqual(['exoplanets']);
  });

  it('expertise_level completes', async () => {
    expect(await completeArg('research_discovery', 'expertise_level', 'ex')).toEqual(['expert']);
  });

  it('topic completes from watches.json', async () => {
    writeWatches([watch('eclipsing binary', []), watch('white dwarf', [])]);
    expect(await completeArg('literature_review', 'topic', 'ecl')).toEqual(['eclipsing binary']);
    expect(await completeArg('research_discovery', 'topic', '')).toEqual(['eclipsing binary', 'white dwarf']);
  });

  it('paper_ids completes the last comma segment only', async () => {
    writeWatches([watch('x', ['2610.00001', '2610.00002'])]);
    expect(await completeArg('compare_papers', 'paper_ids', '2103.01231, 2610.0000')).toEqual([
      '2103.01231,2610.00001', '2103.01231,2610.00002',
    ]);
  });

  it('missing or corrupt watches.json yields no suggestions and is not quarantined', async () => {
    expect(await completeArg('literature_review', 'topic', '')).toEqual([]);
    fs.mkdirSync(stateDir(), { recursive: true });
    const f = path.join(stateDir(), 'watches.json');
    fs.writeFileSync(f, '{nope');
    expect(await completeArg('literature_review', 'topic', '')).toEqual([]);
    expect(fs.readFileSync(f, 'utf8')).toBe('{nope');
  });
});

describe('prompts and instructions', () => {
  it('every tool named in a prompt or the instructions is registered; no stale names', async () => {
    c = await connect();
    const tools = new Set((await c.client.listTools()).tools.map(t => t.name));
    const texts = [INSTRUCTIONS];
    for (const p of (await c.client.listPrompts()).prompts) {
      const args = Object.fromEntries((p.arguments ?? []).map(a => [a.name, a.name === 'focus' ? 'results' : a.name === 'expertise_level' ? 'expert' : 'x']));
      const r = await c.client.getPrompt({ name: p.name, arguments: args });
      for (const m of r.messages) if (m.content.type === 'text') texts.push(m.content.text);
    }
    const all = texts.join('\n');
    const named = new Set(all.match(/\b(?:scix|arxiv)_[a-z_]+\b/g));
    for (const n of named) if (!n.endsWith('_')) expect(tools.has(n), n).toBe(true);
    expect(all).not.toContain('arxiv_download_paper');
  });

  it('instructions carry the redirect, the sections workflow and the untrusted note', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(2048);
    expect(INSTRUCTIONS).toContain('astroquery-mcp');
    expect(INSTRUCTIONS).toMatch(/arxiv_get_paper_outline, then arxiv_read_paper_section/);
    expect(INSTRUCTIONS).toMatch(/untrusted/);
  });

  it('are exposed to the client', async () => {
    c = await connect();
    expect(c.client.getInstructions()).toBe(INSTRUCTIONS);
  });
});
