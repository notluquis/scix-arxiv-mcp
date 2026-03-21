import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScixClient } from '../../src/clients/scix.js';
import {
  handleScixLibraryList,
  handleScixLibraryGet,
  handleScixLibraryCreate,
  handleScixLibraryDocuments,
} from '../../src/tools/scix_library.js';
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

    expect(result).toContain('My Astronomy Papers');
    expect(result).toContain('abc123');
    expect(result).toContain('3');
    expect(result).toContain('owner');
  });

  it('returns not-found message when empty', async () => {
    mockFetch({ body: { libraries: [] } });
    const client = new ScixClient();

    const result = await handleScixLibraryList(client, { filter: 'all' });

    expect(result).toContain('No libraries found');
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

    expect(result).toContain('My Astronomy Papers');
    expect(result).toContain('2024ApJ...1A');
    expect(result).toContain('2023ApJ...2B');
  });

  it('returns not-found message on empty metadata', async () => {
    mockFetch({ body: { documents: [] } });
    const client = new ScixClient();

    const result = await handleScixLibraryGet(client, { library_id: 'nonexistent' });

    expect(result).toContain('not found');
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

    expect(result).toContain('New Library');
    expect(result).toContain('new123');
    expect(result).toContain('2');
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

    expect(result).toContain('Added');
    expect(result).toContain('2');
    expect(result).toContain('abc123');
  });

  it('returns confirmation for remove', async () => {
    mockFetch({ body: { number_removed: 1 } });
    const client = new ScixClient();

    const result = await handleScixLibraryDocuments(client, {
      library_id: 'abc123',
      bibcodes: ['A'],
      action: 'remove',
    });

    expect(result).toContain('Removed');
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
});
