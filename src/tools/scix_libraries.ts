import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ScixClient, getScixClient } from '../clients/scix.js';
import { SCIX_ICONS } from '../icons.js';
import { bibcodeSegment, libraryIdSegment } from '../ids.js';
import {
  CREATE_REMOTE, MUTATE_REMOTE_IDEMPOTENT, READ_EXTERNAL, addTool, listOutput, notFound,
  responseFormat, type ToolOut,
} from '../content.js';

type In<S extends z.ZodType> = Omit<z.infer<S>, 'response_format'>;

// ── Schemas ───────────────────────────────────────────────────────────────────

export const scixLibraryListSchema = z.object({
  filter: z.enum(['all', 'owner', 'collaborator']).default('all').describe(
    'Filter libraries by access type'
  ),
  response_format: responseFormat,
});

export const scixLibraryGetSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier (from scix_library_list)'),
  response_format: responseFormat,
});

export const scixLibraryCreateSchema = z.object({
  name: z.string().min(1).max(255).describe('Library name'),
  description: z.string().max(1000).optional().describe('Library description'),
  public: z.boolean().default(false).describe('Whether the library is publicly visible'),
  bibcodes: z.array(z.string()).optional().describe('Initial papers to add (bibcodes)'),
  response_format: responseFormat,
});

export const scixLibraryDocumentsSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  bibcodes: z.array(z.string().min(1)).min(1).max(2000).describe('Bibcodes to add or remove'),
  action: z.enum(['add', 'remove']).describe('Whether to add or remove the papers'),
  response_format: responseFormat,
});

export const scixLibraryNoteSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  bibcode: z.string().min(1).max(200).describe('Bibcode of the paper to annotate'),
  action: z.enum(['get', 'set', 'delete']).describe(
    '"get" retrieves the note, "set" creates or updates it, "delete" removes it'
  ),
  content: z.string().min(1).max(10000).optional().describe(
    'Note content (required for action="set")'
  ),
  response_format: responseFormat,
});

// ── Handlers ──────────────────────────────────────────────────────────────────

interface LibraryMeta {
  id: string;
  name: string;
  description?: string;
  num_documents: number;
  date_created: string;
  date_last_modified: string;
  permission: string;
  owner: string;
  public: boolean;
  num_users: number;
}

const libraryOut = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  num_documents: z.number().optional(),
  permission: z.string().optional(),
  owner: z.string().optional(),
  public: z.boolean().optional(),
  date_last_modified: z.string().optional(),
});

function libraryRecord(m: Partial<LibraryMeta>) {
  return {
    id: m.id,
    name: m.name ?? '',
    description: m.description,
    num_documents: m.num_documents,
    permission: m.permission,
    owner: m.owner,
    public: m.public,
    date_last_modified: m.date_last_modified,
  };
}

export async function handleScixLibraryList(
  client: ScixClient,
  input: In<typeof scixLibraryListSchema>
): Promise<ToolOut> {
  const params = input.filter !== 'all' ? { access_type: input.filter } : undefined;
  const data = await client.get('biblib/libraries', params) as { libraries?: LibraryMeta[] };
  const libs = data.libraries ?? [];

  if (libs.length === 0) {
    return { text: 'No libraries found.', structured: { total: 0, start: 0, items: [] } };
  }

  let out = `# Libraries (${libs.length})\n\n`;
  for (const lib of libs) {
    out += `## ${lib.name}\n`;
    out += `- **ID:** \`${lib.id}\`\n`;
    if (lib.description) out += `- **Description:** ${lib.description}\n`;
    out += `- **Papers:** ${lib.num_documents}  |  **Permission:** ${lib.permission}  |  **Public:** ${lib.public ? 'Yes' : 'No'}\n`;
    out += `- **Owner:** ${lib.owner}  |  **Modified:** ${lib.date_last_modified.slice(0, 10)}\n\n`;
  }
  return { text: out, structured: { total: libs.length, start: 0, items: libs.map(libraryRecord) } };
}

export async function handleScixLibraryGet(
  client: ScixClient,
  input: In<typeof scixLibraryGetSchema>
): Promise<ToolOut> {
  const id = libraryIdSegment(input.library_id);
  const data = await client.get(`biblib/libraries/${id}`) as {
    metadata?: LibraryMeta;
    documents?: string[];
  } & Partial<LibraryMeta>;

  const meta: Partial<LibraryMeta> = data.metadata ?? data;
  const docs = data.documents ?? [];

  if (!meta?.name) return notFound(`Library ${input.library_id} not found or empty response.`);

  let out = `# ${meta.name}\n\n`;
  out += `- **ID:** \`${meta.id}\`\n`;
  if (meta.description) out += `- **Description:** ${meta.description}\n`;
  out += `- **Papers:** ${meta.num_documents}  |  **Permission:** ${meta.permission}  |  **Public:** ${meta.public ? 'Yes' : 'No'}\n`;
  out += `- **Owner:** ${meta.owner}\n\n`;

  if (docs.length > 0) {
    out += `## Papers (${docs.length})\n\n`;
    docs.forEach((bib, i) => { out += `${i + 1}. \`${bib}\`\n`; });
  }

  return { text: out, structured: { library: libraryRecord(meta), documents: docs } };
}

export async function handleScixLibraryCreate(
  client: ScixClient,
  input: In<typeof scixLibraryCreateSchema>
): Promise<ToolOut> {
  const body: Record<string, unknown> = {
    name: input.name,
    public: input.public,
  };
  if (input.description) body['description'] = input.description;
  if (input.bibcodes?.length) body['bibcodes'] = input.bibcodes;

  const data = await client.post('biblib/libraries', body) as {
    metadata?: {
      name?: string;
      id?: string;
      bibcode?: string[];
      num_documents?: number;
    };
    name?: string;
    id?: string;
    bibcode?: string[];
    num_documents?: number;
  };

  const library = data.metadata ?? data;
  const id = library.id ?? '(unknown)';
  const name = library.name ?? input.name;
  const added = Array.isArray(library.bibcode) ? library.bibcode.length : library.num_documents ?? 0;

  let out = `# Library Created: ${name}\n\n`;
  out += `- **ID:** \`${id}\`\n`;
  if (added > 0) out += `- **Papers added:** ${added}\n`;
  return { text: out, structured: { id, name, papers_added: added } };
}

export async function handleScixLibraryDocuments(
  client: ScixClient,
  input: In<typeof scixLibraryDocumentsSchema>
): Promise<ToolOut> {
  const id = libraryIdSegment(input.library_id);
  const data = await client.post(`biblib/documents/${id}`, {
    bibcode: input.bibcodes,
    action: input.action,
  }) as { number_added?: number; number_removed?: number };

  const changed = data.number_added ?? data.number_removed ?? input.bibcodes.length;
  const verb = input.action === 'add' ? 'Added' : 'Removed';
  return {
    text: `${verb} ${changed} paper(s) ${input.action === 'add' ? 'to' : 'from'} library \`${input.library_id}\`.`,
    structured: { library_id: input.library_id, action: input.action, changed },
  };
}

export async function handleScixLibraryNote(
  client: ScixClient,
  input: In<typeof scixLibraryNoteSchema>
): Promise<ToolOut> {
  const endpoint = `biblib/libraries/${libraryIdSegment(input.library_id)}/notes/${bibcodeSegment(input.bibcode)}`;
  const base = { library_id: input.library_id, bibcode: input.bibcode, action: input.action };

  if (input.action === 'get') {
    const data = await client.get(endpoint) as {
      content?: string;
      date_created?: string;
      date_last_modified?: string;
    };

    if (!data.content) {
      return {
        text: `No note found for \`${input.bibcode}\` in library \`${input.library_id}\`.`,
        structured: { ...base },
      };
    }

    let out = `# Note for \`${input.bibcode}\`\n\n`;
    out += data.content + '\n\n';
    if (data.date_last_modified) out += `*Last updated: ${data.date_last_modified.slice(0, 10)}*\n`;
    return {
      text: out,
      structured: { ...base, content: data.content, date_last_modified: data.date_last_modified },
    };
  }

  if (input.action === 'set') {
    if (!input.content) return notFound('Error: content is required for action="set"');
    await client.post(endpoint, { content: input.content });
    return {
      text: `Note saved for \`${input.bibcode}\` in library \`${input.library_id}\`.`,
      structured: { ...base },
    };
  }

  await client.delete(endpoint);
  return {
    text: `Note deleted for \`${input.bibcode}\` in library \`${input.library_id}\`.`,
    structured: { ...base },
  };
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerScixLibraryTools(server: McpServer): void {
  addTool(server, 'scix_library_list', {
    title: 'List SciX libraries',
    description:
      'List your SciX personal libraries (saved paper collections). ' +
      'Returns library IDs, names, paper counts, and permissions.',
    inputSchema: scixLibraryListSchema,
    outputSchema: listOutput(libraryOut),
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixLibraryList(getScixClient(), input));

  addTool(server, 'scix_library_get', {
    title: 'Get SciX library',
    description: 'Get the contents and metadata of a specific SciX library by its ID.',
    inputSchema: scixLibraryGetSchema,
    outputSchema: z.object({ library: libraryOut, documents: z.array(z.string()) }),
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixLibraryGet(getScixClient(), input));

  addTool(server, 'scix_library_create', {
    title: 'Create SciX library',
    description: 'Create a new personal library in SciX to save and organize papers.',
    inputSchema: scixLibraryCreateSchema,
    outputSchema: z.object({ id: z.string(), name: z.string(), papers_added: z.number() }),
    annotations: CREATE_REMOTE,
    icons: SCIX_ICONS,
  }, input => handleScixLibraryCreate(getScixClient(), input));

  addTool(server, 'scix_library_documents', {
    title: 'Add or remove library papers',
    description: 'Add or remove papers from a SciX library. Pass bibcodes and "add" or "remove".',
    inputSchema: scixLibraryDocumentsSchema,
    outputSchema: z.object({
      library_id: z.string(), action: z.enum(['add', 'remove']), changed: z.number(),
    }),
    annotations: MUTATE_REMOTE_IDEMPOTENT,
    icons: SCIX_ICONS,
  }, input => handleScixLibraryDocuments(getScixClient(), input));

  addTool(server, 'scix_library_note', {
    title: 'Library paper note',
    description: 'Get, set, or delete a personal annotation note for a paper in a SciX library.',
    inputSchema: scixLibraryNoteSchema,
    outputSchema: z.object({
      library_id: z.string(),
      bibcode: z.string(),
      action: z.enum(['get', 'set', 'delete']),
      content: z.string().optional(),
      date_last_modified: z.string().optional(),
    }),
    annotations: MUTATE_REMOTE_IDEMPOTENT,
    icons: SCIX_ICONS,
  }, input => handleScixLibraryNote(getScixClient(), input));
}
