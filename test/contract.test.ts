import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './helpers/harness.js';

const CONTRACT_PATH = new URL('./contract.json', import.meta.url);
const APPROVE = 'APPROVE_CONTRACT=1 pnpm vitest run test/contract.test.ts';
const hint = (what: string) => `${what}\nIf this change is intended, approve it with: ${APPROVE}`;

interface Contract {
  serverInfo: { name: string; title?: string };
  instructions: string | null;
  tools: Array<Record<string, any>>;
  prompts: Array<Record<string, any>>;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sortKeys(x)])
    );
  }
  return v;
}

let actual: Contract;
let close: () => Promise<void>;

beforeAll(async () => {
  const c = await connect();
  close = c.close;
  const info = c.client.getServerVersion();
  actual = JSON.parse(
    JSON.stringify({
      serverInfo: { name: info?.name, title: info?.title }, // version deliberately omitted
      instructions: c.client.getInstructions() ?? null,
      tools: (await c.client.listTools()).tools,
      prompts: (await c.client.listPrompts()).prompts,
    })
  ) as Contract;
  if (process.env.APPROVE_CONTRACT === '1') {
    fs.writeFileSync(CONTRACT_PATH, JSON.stringify(sortKeys(actual), null, 2) + '\n');
  }
});

afterAll(async () => {
  await close?.();
});

describe('contract snapshot', () => {
  const load = (): Contract => {
    if (!fs.existsSync(CONTRACT_PATH)) throw new Error(hint('test/contract.json is missing.'));
    return JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as Contract;
  };

  it('tool names and order', () => {
    const exp = load().tools.map((t) => t.name);
    const act = actual.tools.map((t) => t.name);
    expect(act, hint('Tool list or tool ORDER changed.')).toEqual(exp);
  });

  it('prompt names and order', () => {
    const exp = load().prompts.map((p) => p.name);
    const act = actual.prompts.map((p) => p.name);
    expect(act, hint('Prompt list or prompt ORDER changed.')).toEqual(exp);
  });

  it('server info', () => {
    expect(actual.serverInfo, hint('serverInfo changed.')).toEqual(load().serverInfo);
  });

  it('instructions', () => {
    expect(actual.instructions, hint('Server instructions changed.')).toEqual(load().instructions);
  });

  it('every tool matches the snapshot', () => {
    const exp = load();
    for (const t of actual.tools) {
      const e = exp.tools.find((x) => x.name === t.name);
      expect(t, hint(`Tool "${t.name}" differs from the snapshot.`)).toEqual(e);
    }
  });

  it('every prompt matches the snapshot', () => {
    const exp = load();
    for (const p of actual.prompts) {
      const e = exp.prompts.find((x) => x.name === p.name);
      expect(p, hint(`Prompt "${p.name}" differs from the snapshot.`)).toEqual(e);
    }
  });
});

describe('contract rules', () => {
  it('every tool has outputSchema and annotations', () => {
    for (const t of actual.tools) {
      expect(t.outputSchema, `${t.name} lacks outputSchema`).toBeTruthy();
      expect(t.annotations, `${t.name} lacks annotations`).toBeTruthy();
    }
  });

  it('descriptions and instructions are <= 2048 chars', () => {
    for (const t of actual.tools) {
      expect((t.description ?? '').length, `${t.name} description`).toBeLessThanOrEqual(2048);
    }
    expect((actual.instructions ?? '').length).toBeLessThanOrEqual(2048);
  });

  it('maxResultSizeChars <= 500000', () => {
    for (const t of actual.tools) {
      const v = t._meta?.['anthropic/maxResultSizeChars'];
      if (v !== undefined) expect(v, `${t.name} maxResultSizeChars`).toBeLessThanOrEqual(500000);
    }
  });

  it('tool names match ^[a-z][a-z0-9_]{2,63}$', () => {
    for (const t of actual.tools) expect(t.name).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
  });
});

describe('harness', () => {
  it('callTool on an unknown tool rejects with -32602', async () => {
    const c = await connect();
    try {
      await expect(c.client.callTool({ name: 'no_such_tool', arguments: {} })).rejects.toMatchObject({
        code: -32602,
      });
    } finally {
      await c.close();
    }
  });
});
