import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { connect } from '../helpers/harness.js';

type Calls = { method: string; path: string }[];

/** ADS stand-in: records every call (method + path after /v1/) and serves one library. */
function mockAds(): Calls {
  const calls: Calls = [];
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace(/^https:\/\/[^/]+\/v1\//, '');
    calls.push({ method: init?.method ?? 'GET', path });
    const body = path === 'biblib/libraries/abc123'
      ? { metadata: { id: 'abc123', name: 'Black Holes', num_documents: 3 }, documents: [] }
      : {};
    return { ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

const count = (calls: Calls, method: string, path: string) => calls.filter(c => c.method === method && c.path === path).length;

beforeAll(() => { process.env.SCIX_API_TOKEN = 'test'; });
afterAll(() => { delete process.env.SCIX_API_TOKEN; });
afterEach(() => { vi.restoreAllMocks(); });

const ELICIT = 'elicitation/create' as const;
const text = (r: { content?: unknown }) => (r.content as { text: string }[])[0].text;

describe('scix_library_delete confirmation (input_required)', () => {
  it('accept: asks once, then sends exactly one DELETE', async () => {
    const c = await connect({ elicitation: true });
    const asked: string[] = [];
    c.client.setRequestHandler(ELICIT, async request => {
      asked.push((request.params as { message: string }).message);
      return { action: 'accept', content: { confirm: true } };
    });
    try {
      const calls = mockAds();
      const result = await c.client.callTool({ name: 'scix_library_delete', arguments: { library_id: 'abc123' } });

      expect(result.isError).toBeFalsy();
      expect(count(calls, 'DELETE', 'biblib/documents/abc123')).toBe(1);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain('Delete library Black Holes (3 papers)? This cannot be undone.');
    } finally {
      await c.close();
    }
  });

  it('decline: no DELETE and an isError "Cancelled by user"', async () => {
    const c = await connect({ elicitation: true });
    c.client.setRequestHandler(ELICIT, async () => ({ action: 'decline' }));
    try {
      const calls = mockAds();
      const result = await c.client.callTool({ name: 'scix_library_delete', arguments: { library_id: 'abc123' } });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Cancelled by user');
      expect(calls.filter(x => x.method === 'DELETE')).toHaveLength(0);
    } finally {
      await c.close();
    }
  });

  it('cancel, and accept with confirm=false, also send no DELETE', async () => {
    for (const answer of [{ action: 'cancel' }, { action: 'accept', content: { confirm: false } }] as const) {
      const c = await connect({ elicitation: true });
      c.client.setRequestHandler(ELICIT, async () => answer);
      try {
        const calls = mockAds();
        const result = await c.client.callTool({ name: 'scix_library_delete', arguments: { library_id: 'abc123' } });
        expect(result.isError).toBe(true);
        expect(calls.filter(x => x.method === 'DELETE')).toHaveLength(0);
      } finally {
        await c.close();
      }
    }
  });

  it('a client without the elicitation capability gets exactly one DELETE and no lookup', async () => {
    const c = await connect();
    try {
      const calls = mockAds();
      const result = await c.client.callTool({ name: 'scix_library_delete', arguments: { library_id: 'abc123' } });

      expect(result.isError).toBeFalsy();
      expect(calls).toEqual([{ method: 'DELETE', path: 'biblib/documents/abc123' }]);
    } finally {
      await c.close();
    }
  });
});

describe('scix_library_transfer confirmation (input_required)', () => {
  const args = { library_id: 'abc123', email: 'new@example.com' };

  it('accept: asks once (naming the new owner), then sends exactly one transfer POST', async () => {
    const c = await connect({ elicitation: true });
    const asked: string[] = [];
    c.client.setRequestHandler(ELICIT, async request => {
      asked.push((request.params as { message: string }).message);
      return { action: 'accept', content: { confirm: true } };
    });
    try {
      const calls = mockAds();
      const result = await c.client.callTool({ name: 'scix_library_transfer', arguments: args });

      expect(result.isError).toBeFalsy();
      expect(count(calls, 'POST', 'biblib/transfer/abc123')).toBe(1);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain('Black Holes');
      expect(asked[0]).toContain('new@example.com');
    } finally {
      await c.close();
    }
  });

  it('decline: no transfer and an isError', async () => {
    const c = await connect({ elicitation: true });
    c.client.setRequestHandler(ELICIT, async () => ({ action: 'decline' }));
    try {
      const calls = mockAds();
      const result = await c.client.callTool({ name: 'scix_library_transfer', arguments: args });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Cancelled by user');
      expect(calls.filter(x => x.method === 'POST')).toHaveLength(0);
    } finally {
      await c.close();
    }
  });

  it('a client without the elicitation capability gets exactly one transfer POST', async () => {
    const c = await connect();
    try {
      const calls = mockAds();
      const result = await c.client.callTool({ name: 'scix_library_transfer', arguments: args });

      expect(result.isError).toBeFalsy();
      expect(calls).toEqual([{ method: 'POST', path: 'biblib/transfer/abc123' }]);
    } finally {
      await c.close();
    }
  });
});

describe('library management tools over the real protocol', () => {
  it('response_format json is honoured by get_permissions, and the structured result validates', async () => {
    const c = await connect();
    try {
      global.fetch = vi.fn(async () => ({
        ok: true, status: 200, headers: new Headers(),
        json: async () => ({ owner: 'me@example.com', collaborators: { 'a@b.co': ['read'] } }),
        text: async () => '{}',
      }) as Response) as unknown as typeof fetch;
      const result = await c.client.callTool({
        name: 'scix_library_get_permissions', arguments: { library_id: 'abc123', response_format: 'json' },
      });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(text(result))).toMatchObject({ owner: 'me@example.com' });
    } finally {
      await c.close();
    }
  });

  it('update_permissions rejects an invalid email at the schema', async () => {
    const c = await connect();
    try {
      const calls = mockAds();
      const result = await c.client.callTool({
        name: 'scix_library_update_permissions',
        arguments: { library_id: 'abc123', email: 'not-an-email', permission: 'read' },
      }).catch((e: unknown) => ({ isError: true, content: [{ text: String(e) }] }));
      expect(result.isError).toBe(true);
      expect(calls).toHaveLength(0);
    } finally {
      await c.close();
    }
  });
});
