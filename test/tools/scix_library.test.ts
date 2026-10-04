import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScixClient } from '../../src/clients/scix.js';
import {
  handleScixLibraryList,
  handleScixLibraryGet,
  handleScixLibraryCreate,
  handleScixLibraryDocuments,
  handleScixLibraryNote,
} from '../../src/tools/scix_libraries.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';

const MOCK_LIB = {
  id: 'abc123',
  name: 'My Astronomy Papers',
  description: 'Papers about black holes',
  num_documents: 3,
  date_created: '2024-01-01T00:00:00',
  date_last_modified: '2024-06-15T00:00:00',
  permission: 'owner',
  owner: 'user@example.com',
  public: false,
  num_users: 1,
};

describe('handleScixLibraryList', () => {
  beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
  afterEach(restoreFetch);

  it('returns formatted library list', async () => {
    mockFetch({ body: { libraries: [MOCK_LIB] } });
    const client = new ScixClient();

    const result = await handleScixLibraryList(client, { filter: 'all' });

    expect(result.text).toContain('My Astronomy Papers');
    expect(result.text).toContain('abc123');
    expect(result.text).toContain('3');
    expect(result.text).toContain('owner');
  });

  it('returns not-found message when empty', async () => {
    mockFetch({ body: { libraries: [] } });
    const client = new ScixClient();

    const result = await handleScixLibraryList(client, { filter: 'all' });

    expect(result.text).toContain('No libraries found');
  });

  it('sends access_type param when filter is not "all"', async () => {
    const mock = mockFetch({ body: { libraries: [] } });
    const client = new ScixClient();

    await handleScixLibraryList(client, { filter: 'owner' });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('access_type=owner');
  });

  it('does not send access_type for filter=all', async () => {
    const mock = mockFetch({ body: { libraries: [] } });
    const client = new ScixClient();

    await handleScixLibraryList(client, { filter: 'all' });

    const [url] = mock.mock.calls[0];
    expect(url).not.toContain('access_type');
  });
});

describe('handleScixLibraryGet', () => {
  beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
  afterEach(restoreFetch);

  it('returns library metadata and documents', async () => {
    mockFetch({
      body: {
        metadata: MOCK_LIB,
        documents: ['2024ApJ...1A', '2023ApJ...2B'],
      },
    });
    const client = new ScixClient();

    const result = await handleScixLibraryGet(client, { library_id: 'abc123' });

    expect(result.text).toContain('My Astronomy Papers');
    expect(result.text).toContain('2024ApJ...1A');
    expect(result.text).toContain('2023ApJ...2B');
  });

  it('returns not-found message on empty metadata', async () => {
    mockFetch({ body: { documents: [] } });
    const client = new ScixClient();

    const result = await handleScixLibraryGet(client, { library_id: 'nonexistent' });

    expect(result.text).toContain('not found');
  });

  it('handles library metadata returned at the root level', async () => {
    mockFetch({
      body: {
        ...MOCK_LIB,
        documents: ['2024ApJ...1A'],
      },
    });
    const client = new ScixClient();

    const result = await handleScixLibraryGet(client, { library_id: 'abc123' });

    expect(result.text).toContain('My Astronomy Papers');
    expect(result.text).toContain('2024ApJ...1A');
  });
});

describe('handleScixLibraryCreate', () => {
  beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
  afterEach(restoreFetch);

  it('returns created library info', async () => {
    mockFetch({ body: { id: 'new123', name: 'New Library', bibcode: ['A', 'B'] } });
    const client = new ScixClient();

    const result = await handleScixLibraryCreate(client, {
      name: 'New Library',
      public: false,
      bibcodes: ['A', 'B'],
    });

    expect(result.text).toContain('New Library');
    expect(result.text).toContain('new123');
    expect(result.text).toContain('2');
  });

  it('POSTs to biblib/libraries', async () => {
    const mock = mockFetch({ body: { id: 'x', name: 'X' } });
    const client = new ScixClient();

    await handleScixLibraryCreate(client, { name: 'X', public: true });

    const [url, init] = mock.mock.calls[0];
    expect(url).toContain('biblib/libraries');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body.name).toBe('X');
    expect(body.public).toBe(true);
  });

  it('handles created library metadata returned under metadata', async () => {
    mockFetch({
      body: {
        metadata: {
          ...MOCK_LIB,
          id: 'meta123',
          name: 'Metadata Library',
          num_documents: 4,
        },
      },
    });
    const client = new ScixClient();

    const result = await handleScixLibraryCreate(client, {
      name: 'Metadata Library',
      public: false,
    });

    expect(result.text).toContain('Metadata Library');
    expect(result.text).toContain('meta123');
    expect(result.text).toContain('4');
  });
});

describe('handleScixLibraryDocuments', () => {
  beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
  afterEach(restoreFetch);

  it('returns confirmation for add', async () => {
    mockFetch({ body: { number_added: 2 } });
    const client = new ScixClient();

    const result = await handleScixLibraryDocuments(client, {
      library_id: 'abc123',
      bibcodes: ['A', 'B'],
      action: 'add',
    });

    expect(result.text).toContain('Added');
    expect(result.text).toContain('2');
    expect(result.text).toContain('abc123');
  });

  it('returns confirmation for remove', async () => {
    mockFetch({ body: { number_removed: 1 } });
    const client = new ScixClient();

    const result = await handleScixLibraryDocuments(client, {
      library_id: 'abc123',
      bibcodes: ['A'],
      action: 'remove',
    });

    expect(result.text).toContain('Removed');
  });

  it('POSTs correct action and bibcodes', async () => {
    const mock = mockFetch({ body: { number_added: 1 } });
    const client = new ScixClient();

    await handleScixLibraryDocuments(client, {
      library_id: 'lib1',
      bibcodes: ['X'],
      action: 'add',
    });

    const [url, init] = mock.mock.calls[0];
    expect(url).toContain('biblib/documents/lib1');
    const body = JSON.parse(init?.body as string);
    expect(body.action).toBe('add');
    expect(body.bibcode).toEqual(['X']);
  });

  it('rejects a library_id that would retarget the request', async () => {
    const mock = mockFetch({ body: { number_added: 1 } });
    const client = new ScixClient();

    await expect(handleScixLibraryDocuments(client, {
      library_id: '../libraries/other', bibcodes: ['X'], action: 'add',
    })).rejects.toThrow('Invalid library_id');
    expect(mock).not.toHaveBeenCalled();
  });
});

describe('library id validation and structured output', () => {
  beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
  afterEach(restoreFetch);

  it('scix_library_get rejects dot segments and slashes in library_id', async () => {
    const mock = mockFetch({ body: {} });
    const client = new ScixClient();

    for (const bad of ['..', '../x', 'a/b', 'a?b=1']) {
      await expect(handleScixLibraryGet(client, { library_id: bad })).rejects.toThrow('Invalid library_id');
    }
    expect(mock).not.toHaveBeenCalled();
  });

  it('list, get and create return structured records', async () => {
    mockFetch({ body: { libraries: [MOCK_LIB] } });
    const list = await handleScixLibraryList(new ScixClient(), { filter: 'all' });
    expect(list.structured).toMatchObject({ total: 1, start: 0, items: [{ id: 'abc123', name: 'My Astronomy Papers' }] });

    mockFetch({ body: { metadata: MOCK_LIB, documents: ['2024ApJ...1A'] } });
    const get = await handleScixLibraryGet(new ScixClient(), { library_id: 'abc123' });
    expect(get.structured).toMatchObject({ library: { id: 'abc123' }, documents: ['2024ApJ...1A'] });

    mockFetch({ body: { id: 'new123', name: 'New', bibcode: ['A', 'B'] } });
    const created = await handleScixLibraryCreate(new ScixClient(), { name: 'New', public: false });
    expect(created.structured).toEqual({ id: 'new123', name: 'New', papers_added: 2 });
  });

  it('create sends description and bibcodes when given (non-default branch)', async () => {
    const mock = mockFetch({ body: { id: 'x', name: 'X' } });

    await handleScixLibraryCreate(new ScixClient(), {
      name: 'X', public: false, description: 'about stars', bibcodes: ['A', 'B'],
    });

    const body = JSON.parse(mock.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({ description: 'about stars', bibcodes: ['A', 'B'] });
  });
});

describe('handleScixLibraryNote', () => {
  beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
  afterEach(restoreFetch);

  it('get returns the note', async () => {
    const mock = mockFetch({ body: { content: 'remember this', date_last_modified: '2024-06-15T00:00:00' } });

    const result = await handleScixLibraryNote(new ScixClient(), {
      library_id: 'abc123', bibcode: '2019ApJ...882L..24A', action: 'get',
    });

    expect(String(mock.mock.calls[0][0])).toContain('biblib/libraries/abc123/notes/2019ApJ...882L..24A');
    expect(result.text).toContain('remember this');
    expect(result.text).toContain('2024-06-15');
    expect(result.structured).toMatchObject({ action: 'get', content: 'remember this' });
  });

  it('get reports a missing note without failing', async () => {
    mockFetch({ body: {} });

    const result = await handleScixLibraryNote(new ScixClient(), { library_id: 'abc123', bibcode: 'B', action: 'get' });

    expect(result.text).toContain('No note found');
    expect(result.isError).toBeUndefined();
  });

  it('set POSTs the content; delete sends DELETE', async () => {
    const mock = mockFetch({ body: {} });
    const client = new ScixClient();

    const set = await handleScixLibraryNote(client, { library_id: 'abc123', bibcode: 'B', action: 'set', content: 'hello' });
    const del = await handleScixLibraryNote(client, { library_id: 'abc123', bibcode: 'B', action: 'delete' });

    expect(set.text).toContain('Note saved');
    expect(mock.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(mock.mock.calls[0][1]?.body as string)).toEqual({ content: 'hello' });
    expect(del.text).toContain('Note deleted');
    expect(mock.mock.calls[1][1]?.method).toBe('DELETE');
  });

  it('set without content is an error and sends nothing', async () => {
    const mock = mockFetch({ body: {} });

    const result = await handleScixLibraryNote(new ScixClient(), { library_id: 'abc123', bibcode: 'B', action: 'set' });

    expect(result.isError).toBe(true);
    expect(mock).not.toHaveBeenCalled();
  });

  it('rejects path-breaking library_id and bibcode, and encodes the bibcode', async () => {
    const mock = mockFetch({ body: {} });
    const client = new ScixClient();

    await expect(handleScixLibraryNote(client, { library_id: '../x', bibcode: 'B', action: 'get' })).rejects.toThrow('Invalid library_id');
    await expect(handleScixLibraryNote(client, { library_id: 'abc123', bibcode: '../../x', action: 'delete' })).rejects.toThrow('Invalid bibcode');
    expect(mock).not.toHaveBeenCalled();

    await handleScixLibraryNote(client, { library_id: 'abc123', bibcode: '2020A&A...641A...6P', action: 'get' });
    expect(String(mock.mock.calls[0][0])).toContain('/notes/2020A%26A...641A...6P');
  });
});
