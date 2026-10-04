import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScixClient } from '../../src/clients/scix.js';
import {
  handleScixLibraryAddByQuery,
  handleScixLibraryDelete,
  handleScixLibraryEdit,
  handleScixLibraryGetPermissions,
  handleScixLibraryOperation,
  handleScixLibraryTransfer,
  handleScixLibraryUpdatePermissions,
} from '../../src/tools/scix_libraries.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';

const sent = (mock: ReturnType<typeof mockFetch>, i: number) => ({
  url: String(mock.mock.calls[i][0]),
  method: mock.mock.calls[i][1]?.method,
  body: mock.mock.calls[i][1]?.body ? JSON.parse(mock.mock.calls[i][1]?.body as string) : undefined,
});

beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
afterEach(restoreFetch);

describe('handleScixLibraryEdit', () => {
  it.each([
    ['name', { name: 'Renamed' }],
    ['description', { description: 'new text' }],
    ['public', { public: true }],
    ['public=false', { public: false }],
  ])('PUTs only the %s field to biblib/documents/{id}', async (_label, fields) => {
    const mock = mockFetch({ body: { id: 'abc123', name: 'Renamed' } });

    const result = await handleScixLibraryEdit(new ScixClient(), { library_id: 'abc123', ...fields });

    expect(mock).toHaveBeenCalledTimes(1);
    expect(sent(mock, 0)).toMatchObject({ method: 'PUT', body: fields });
    expect(sent(mock, 0).url).toContain('biblib/documents/abc123');
    expect(Object.keys(sent(mock, 0).body)).toEqual(Object.keys(fields));
    expect(result.structured).toMatchObject({ updated: Object.keys(fields) });
  });

  it('sends everything when everything is given', async () => {
    const mock = mockFetch({ body: { metadata: { id: 'abc123', name: 'N', public: true } } });
    await handleScixLibraryEdit(new ScixClient(), { library_id: 'abc123', name: 'N', description: 'D', public: true });
    expect(sent(mock, 0).body).toEqual({ name: 'N', description: 'D', public: true });
  });

  it('with no field to change is an error and sends nothing', async () => {
    const mock = mockFetch();
    const result = await handleScixLibraryEdit(new ScixClient(), { library_id: 'abc123' });
    expect(result.isError).toBe(true);
    expect(mock).not.toHaveBeenCalled();
  });

  it('rejects a path-breaking library_id', async () => {
    const mock = mockFetch();
    await expect(handleScixLibraryEdit(new ScixClient(), { library_id: '../x', name: 'N' })).rejects.toThrow('Invalid library_id');
    expect(mock).not.toHaveBeenCalled();
  });
});

describe('handleScixLibraryDelete / Transfer without a ctx (no elicitation)', () => {
  it('delete sends exactly one DELETE to biblib/documents/{id}', async () => {
    const mock = mockFetch({ status: 204, body: {} });
    const result = await handleScixLibraryDelete(new ScixClient(), { library_id: 'abc123' });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(sent(mock, 0)).toMatchObject({ method: 'DELETE' });
    expect(sent(mock, 0).url).toContain('biblib/documents/abc123');
    expect(result).toMatchObject({ structured: { deleted: true } });
  });

  it('transfer POSTs the new owner to biblib/transfer/{id}', async () => {
    const mock = mockFetch({ body: {} });
    await handleScixLibraryTransfer(new ScixClient(), { library_id: 'abc123', email: 'new@example.com' });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(sent(mock, 0)).toMatchObject({ method: 'POST', body: { email: 'new@example.com' } });
    expect(sent(mock, 0).url).toContain('biblib/transfer/abc123');
  });

  it('reject path-breaking ids before any request', async () => {
    const mock = mockFetch();
    await expect(handleScixLibraryDelete(new ScixClient(), { library_id: 'a/b' })).rejects.toThrow('Invalid library_id');
    await expect(handleScixLibraryTransfer(new ScixClient(), { library_id: '..', email: 'a@b.co' })).rejects.toThrow('Invalid library_id');
    expect(mock).not.toHaveBeenCalled();
  });
});

describe('handleScixLibraryAddByQuery', () => {
  it('POSTs query and the non-default rows to the query endpoint', async () => {
    const mock = mockFetch({ body: { number_added: 7 } });
    const result = await handleScixLibraryAddByQuery(new ScixClient(), { library_id: 'abc123', query: 'author:"Hawking"', rows: 7 });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(sent(mock, 0).url).toContain('biblib/documents/abc123/query');
    expect(sent(mock, 0).body).toEqual({ query: 'author:"Hawking"', rows: 7 });
    expect(result.structured).toMatchObject({ added: 7, via: 'query_endpoint' });
  });

  it('on 404 falls back to search then add, passing rows to the search', async () => {
    const mock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const respond = (status: number, body: unknown) => ({
        ok: status < 300, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body),
      }) as Response;
      if (u.endsWith('/query') && init?.method === 'POST') return respond(404, { error: 'nope' });
      if (u.includes('search/query')) return respond(200, { response: { docs: [{ bibcode: 'A' }, { bibcode: 'B' }, {}] } });
      return respond(200, { number_added: 2 });
    });
    global.fetch = mock as unknown as typeof fetch;

    const result = await handleScixLibraryAddByQuery(new ScixClient(), { library_id: 'abc123', query: 'black holes', rows: 3 });

    const calls = mock.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${String(u).replace(/^https:\/\/[^/]+\/v1\//, '')}`);
    expect(calls).toEqual([
      'POST biblib/documents/abc123/query',
      'GET search/query?q=black+holes&rows=3&fl=bibcode&start=0',
      'POST biblib/documents/abc123',
    ]);
    expect(JSON.parse(mock.mock.calls[2][1]?.body as string)).toEqual({ bibcode: ['A', 'B'], action: 'add' });
    expect(result.structured).toMatchObject({ found: 2, added: 2, via: 'search_fallback' });
  });

  it('fallback with zero hits adds nothing', async () => {
    const mock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      const status = u.includes('search/query') ? 200 : 404;
      return { ok: status === 200, status, headers: new Headers(), text: async () => '{}', json: async () => ({ response: { docs: [] } }) } as Response;
    });
    global.fetch = mock as unknown as typeof fetch;
    const result = await handleScixLibraryAddByQuery(new ScixClient(), { library_id: 'abc123', query: 'zzz', rows: 25 });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(result.structured).toMatchObject({ found: 0, added: 0 });
  });

  it('a non-404 error from the query endpoint is not swallowed by the fallback', async () => {
    const mock = mockFetch({ status: 403, text: 'forbidden' });
    await expect(handleScixLibraryAddByQuery(new ScixClient(), { library_id: 'abc123', query: 'q', rows: 25 })).rejects.toThrow('403');
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe('handleScixLibraryOperation', () => {
  it('union sends action and the validated source libraries', async () => {
    const mock = mockFetch({ body: { library_id: 'abc123', number_added: 4 } });
    const result = await handleScixLibraryOperation(new ScixClient(), {
      library_id: 'abc123', operation: 'union', source_library_ids: ['s1', 's2'],
    });
    expect(sent(mock, 0).url).toContain('biblib/libraries/operations/abc123');
    expect(sent(mock, 0).body).toEqual({ action: 'union', libraries: ['s1', 's2'] });
    expect(result.structured).toMatchObject({ documents_affected: 4 });
  });

  it.each(['intersection', 'difference'] as const)('%s without sources is an error and sends nothing', async operation => {
    const mock = mockFetch();
    const result = await handleScixLibraryOperation(new ScixClient(), { library_id: 'abc123', operation });
    expect(result.isError).toBe(true);
    expect(mock).not.toHaveBeenCalled();
  });

  it('copy sends name and description; other operations do not', async () => {
    const mock = mockFetch({ body: { library_id: 'new1' } });
    const client = new ScixClient();
    const copy = await handleScixLibraryOperation(client, {
      library_id: 'abc123', operation: 'copy', name: 'Copy of it', description: 'a copy',
    });
    await handleScixLibraryOperation(client, {
      library_id: 'abc123', operation: 'empty', name: 'ignored', description: 'ignored',
    });
    expect(sent(mock, 0).body).toEqual({ action: 'copy', name: 'Copy of it', description: 'a copy' });
    expect(sent(mock, 1).body).toEqual({ action: 'empty' });
    expect(copy.structured).toMatchObject({ new_library_id: 'new1' });
  });

  it('rejects a path-breaking source library id before sending', async () => {
    const mock = mockFetch();
    await expect(handleScixLibraryOperation(new ScixClient(), {
      library_id: 'abc123', operation: 'union', source_library_ids: ['ok', '../evil'],
    })).rejects.toThrow('Invalid library_id');
    expect(mock).not.toHaveBeenCalled();
  });
});

describe('permissions', () => {
  it('get lists owner and collaborators', async () => {
    const mock = mockFetch({ body: { owner: 'me@example.com', collaborators: { 'a@b.co': ['read'], 'c@d.co': ['write', 'read'] } } });
    const result = await handleScixLibraryGetPermissions(new ScixClient(), { library_id: 'abc123' });
    expect(sent(mock, 0)).toMatchObject({ method: 'GET' });
    expect(sent(mock, 0).url).toContain('biblib/permissions/abc123');
    expect(result.text).toContain('a@b.co');
    expect(result.structured).toMatchObject({
      owner: 'me@example.com',
      collaborators: [{ email: 'a@b.co', permissions: ['read'] }, { email: 'c@d.co', permissions: ['write', 'read'] }],
    });
  });

  it('get with no collaborators says so', async () => {
    mockFetch({ body: { owner: 'me@example.com' } });
    const result = await handleScixLibraryGetPermissions(new ScixClient(), { library_id: 'abc123' });
    expect(result.text).toContain('No collaborators');
  });

  it.each(['owner', 'admin', 'write', 'read'] as const)('update POSTs permission=%s', async permission => {
    const mock = mockFetch({ body: {} });
    await handleScixLibraryUpdatePermissions(new ScixClient(), { library_id: 'abc123', email: 'a@b.co', permission });
    expect(sent(mock, 0).url).toContain('biblib/permissions/abc123');
    expect(sent(mock, 0).body).toEqual({ email: 'a@b.co', permission });
  });
});

describe('mutations are not retried blindly', () => {
  it('a 503 on PUT is not retried; a 429 is', async () => {
    const mock503 = mockFetch({ status: 503, text: 'unavailable' });
    await expect(handleScixLibraryEdit(new ScixClient(), { library_id: 'abc123', name: 'N' })).rejects.toThrow('503');
    expect(mock503).toHaveBeenCalledTimes(1);

    let n = 0;
    const mock429 = vi.fn(async () => {
      n += 1;
      const status = n === 1 ? 429 : 200;
      return {
        ok: status === 200, status, headers: new Headers({ 'retry-after': '0' }),
        text: async () => '{}', json: async () => ({ name: 'N' }),
      } as Response;
    });
    global.fetch = mock429 as unknown as typeof fetch;
    await handleScixLibraryEdit(new ScixClient(), { library_id: 'abc123', name: 'N' });
    expect(mock429).toHaveBeenCalledTimes(2);
  });
});
