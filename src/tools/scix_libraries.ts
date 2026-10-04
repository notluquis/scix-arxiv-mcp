import {
  CLIENT_CAPABILITIES_META_KEY, acceptedContent, inputRequired, inputResponse,
  type InputRequiredResult, type McpServer, type ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ScixApiError, ScixClient, getScixClient } from '../clients/scix.js';
import { SCIX_ICONS } from '../icons.js';
import { bibcodeSegment, libraryIdSegment } from '../ids.js';
import {
  CREATE_REMOTE, DESTRUCTIVE_REMOTE, MUTATE_REMOTE_IDEMPOTENT, READ_EXTERNAL, addTool, listOutput, notFound,
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

export const scixLibraryEditSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  name: z.string().min(1).max(255).optional().describe('New library name'),
  description: z.string().max(1000).optional().describe('New library description'),
  public: z.boolean().optional().describe('Whether the library is publicly visible'),
  response_format: responseFormat,
});

export const scixLibraryDeleteSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  response_format: responseFormat,
});

export const scixLibraryAddByQuerySchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  query: z.string().min(1).describe('SciX search query; its top results are added to the library'),
  rows: z.number().int().min(1).max(2000).default(25).describe('How many results to add (default 25)'),
  response_format: responseFormat,
});

export const scixLibraryOperationSchema = z.object({
  library_id: z.string().min(1).describe('Target library identifier'),
  operation: z.enum(['union', 'intersection', 'difference', 'copy', 'empty']).describe(
    'union/intersection/difference combine the target with source_library_ids; copy duplicates the target ' +
    'into a new library; empty removes every paper from the target'
  ),
  source_library_ids: z.array(z.string().min(1)).max(50).optional().describe(
    'Other libraries to combine with the target (required for union, intersection, difference)'
  ),
  name: z.string().min(1).max(255).optional().describe('Name of the new library (copy only)'),
  description: z.string().max(1000).optional().describe('Description of the new library (copy only)'),
  response_format: responseFormat,
});

export const scixLibraryGetPermissionsSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  response_format: responseFormat,
});

export const scixLibraryUpdatePermissionsSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  email: z.email().describe('Email of the user whose access changes'),
  permission: z.enum(['owner', 'admin', 'write', 'read']).describe('Permission level to grant'),
  response_format: responseFormat,
});

export const scixLibraryTransferSchema = z.object({
  library_id: z.string().min(1).describe('Library identifier'),
  email: z.email().describe('Email of the new owner'),
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

// ── Confirmation (input_required) ────────────────────────────────────────────

const confirmSchema = z.object({ confirm: z.boolean() });

/** True when the client declared the elicitation capability on this request (2026 envelope, keyed by meta-key). */
function clientCanElicit(ctx: ServerContext | undefined): boolean {
  const envelope = ctx?.mcpReq.envelope as Record<string, unknown> | undefined;
  const caps = envelope?.[CLIENT_CAPABILITIES_META_KEY] as { elicitation?: unknown } | undefined;
  return caps?.elicitation !== undefined && caps.elicitation !== null;
}

/**
 * Asks the user to confirm an irreversible action. Returns 'proceed' (confirmed, or the client
 * cannot be asked: Claude Code's permission prompt for non-read-only tools is then the gate),
 * 'cancelled' (declined, cancelled or confirm=false), or the `input_required` result to send back.
 * Only the library lookup runs on the first round; the retry carries the answer.
 */
async function confirmDestructive(
  client: ScixClient,
  ctx: ServerContext | undefined,
  id: string,
  describe: (name: string, papers: number | undefined) => string
): Promise<'proceed' | 'cancelled' | InputRequiredResult> {
  if (!ctx || !clientCanElicit(ctx)) return 'proceed';

  const answer = inputResponse(ctx.mcpReq.inputResponses, 'confirm');
  if (answer.kind === 'elicit') {
    const accepted = acceptedContent(ctx.mcpReq.inputResponses, 'confirm', confirmSchema);
    return accepted?.confirm === true ? 'proceed' : 'cancelled';
  }

  const data = await client.get(`biblib/libraries/${id}`) as { metadata?: Partial<LibraryMeta> } & Partial<LibraryMeta>;
  const meta = data.metadata ?? data;
  return inputRequired({
    inputRequests: {
      confirm: inputRequired.elicit({
        message: describe(meta.name ?? id, meta.num_documents),
        requestedSchema: confirmSchema,
      }),
    },
  });
}

const CANCELLED: ToolOut = { text: 'Cancelled by user', structured: {}, isError: true };

const papersOf = (n: number | undefined) => (n === undefined ? '' : ` (${n} papers)`);

export async function handleScixLibraryEdit(
  client: ScixClient,
  input: In<typeof scixLibraryEditSchema>
): Promise<ToolOut> {
  const id = libraryIdSegment(input.library_id);
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body['name'] = input.name;
  if (input.description !== undefined) body['description'] = input.description;
  if (input.public !== undefined) body['public'] = input.public;
  if (Object.keys(body).length === 0) {
    return notFound('Error: provide at least one of name, description or public to update.');
  }

  // ADS keeps library metadata updates on the documents endpoint.
  const data = await client.put(`biblib/documents/${id}`, body) as { metadata?: Partial<LibraryMeta> } & Partial<LibraryMeta>;
  const meta = data.metadata ?? data;
  const record = { ...libraryRecord(meta), id: meta.id ?? input.library_id, ...body };

  let out = `# Library updated: ${record.name || input.library_id}\n\n`;
  out += `- **ID:** \`${record.id}\`\n`;
  for (const key of ['name', 'description', 'public'] as const) {
    if (body[key] !== undefined) out += `- **${key}:** ${String(body[key])}\n`;
  }
  return { text: out, structured: { library: record, updated: Object.keys(body) } };
}

export async function handleScixLibraryDelete(
  client: ScixClient,
  input: In<typeof scixLibraryDeleteSchema>,
  ctx?: ServerContext
): Promise<ToolOut | InputRequiredResult> {
  const id = libraryIdSegment(input.library_id);
  const gate = await confirmDestructive(client, ctx, id, (name, n) =>
    `Delete library ${name}${papersOf(n)}? This cannot be undone.`);
  if (gate === 'cancelled') return CANCELLED;
  if (gate !== 'proceed') return gate;

  // SciX deletes a library through the documents endpoint.
  await client.delete(`biblib/documents/${id}`);
  return {
    text: `Library \`${input.library_id}\` deleted.`,
    structured: { library_id: input.library_id, deleted: true },
  };
}

interface DocumentUpdate { number_added?: number }

export async function handleScixLibraryAddByQuery(
  client: ScixClient,
  input: In<typeof scixLibraryAddByQuerySchema>
): Promise<ToolOut> {
  const id = libraryIdSegment(input.library_id);
  const base = { library_id: input.library_id, query: input.query, requested: input.rows };

  try {
    const data = await client.post(`biblib/documents/${id}/query`, { query: input.query, rows: input.rows }) as DocumentUpdate;
    const added = data.number_added ?? 0;
    return {
      text: `Added ${added} paper(s) from query \`${input.query}\` to library \`${input.library_id}\`.`,
      structured: { ...base, found: added, added, via: 'query_endpoint' },
    };
  } catch (e) {
    // A 404 means the endpoint did nothing (not deployed for this library): safe to fall back.
    if (!(e instanceof ScixApiError && e.status === 404)) throw e;
  }

  const found = await client.get('search/query', { q: input.query, rows: input.rows, fl: 'bibcode', start: 0 }) as {
    response?: { docs?: { bibcode?: unknown }[] };
  };
  const bibcodes = (found.response?.docs ?? [])
    .map(d => d.bibcode)
    .filter((b): b is string => typeof b === 'string' && b.length > 0);
  if (bibcodes.length === 0) {
    return {
      text: `No documents found for query \`${input.query}\`; nothing added.`,
      structured: { ...base, found: 0, added: 0, via: 'search_fallback' },
    };
  }

  const data = await client.post(`biblib/documents/${id}`, { bibcode: bibcodes, action: 'add' }) as DocumentUpdate;
  const added = data.number_added ?? bibcodes.length;
  return {
    text: `Added ${added} paper(s) from query \`${input.query}\` to library \`${input.library_id}\` (search fallback).`,
    structured: { ...base, found: bibcodes.length, added, via: 'search_fallback' },
  };
}

export async function handleScixLibraryOperation(
  client: ScixClient,
  input: In<typeof scixLibraryOperationSchema>,
  ctx?: ServerContext
): Promise<ToolOut | InputRequiredResult> {
  const id = libraryIdSegment(input.library_id);
  const needsSources = input.operation === 'union' || input.operation === 'intersection' || input.operation === 'difference';
  if (needsSources && !input.source_library_ids?.length) {
    return notFound(`Error: source_library_ids is required for operation="${input.operation}".`);
  }

  if (input.operation === 'empty') {
    const gate = await confirmDestructive(client, ctx, id, (name, n) =>
      `Remove every paper from library ${name}${papersOf(n)}? This cannot be undone.`);
    if (gate === 'cancelled') return CANCELLED;
    if (gate !== 'proceed') return gate;
  }

  const body: Record<string, unknown> = { action: input.operation };
  if (input.source_library_ids?.length) body['libraries'] = input.source_library_ids.map(libraryIdSegment);
  if (input.operation === 'copy') {
    if (input.name) body['name'] = input.name;
    if (input.description) body['description'] = input.description;
  }

  const data = await client.post(`biblib/libraries/operations/${id}`, body) as { library_id?: string; number_added?: number };
  let out = `Library operation \`${input.operation}\` on \`${input.library_id}\` completed.\n`;
  if (data.library_id) out += `- **New library ID:** \`${data.library_id}\`\n`;
  if (data.number_added !== undefined) out += `- **Documents affected:** ${data.number_added}\n`;
  return {
    text: out,
    structured: {
      library_id: input.library_id, operation: input.operation,
      new_library_id: data.library_id, documents_affected: data.number_added,
    },
  };
}

export async function handleScixLibraryGetPermissions(
  client: ScixClient,
  input: In<typeof scixLibraryGetPermissionsSchema>
): Promise<ToolOut> {
  const id = libraryIdSegment(input.library_id);
  const data = await client.get(`biblib/permissions/${id}`) as { owner?: string; collaborators?: Record<string, string[]> };
  const collaborators = Object.entries(data.collaborators ?? {}).map(([email, permissions]) => ({ email, permissions }));

  let out = `# Permissions for \`${input.library_id}\`\n\n`;
  if (data.owner) out += `- **Owner:** ${data.owner}\n`;
  if (collaborators.length === 0) out += '\nNo collaborators.\n';
  else {
    out += '\n## Collaborators\n\n';
    for (const c of collaborators) out += `- **${c.email}:** ${c.permissions.join(', ')}\n`;
  }
  return { text: out, structured: { library_id: input.library_id, owner: data.owner, collaborators } };
}

export async function handleScixLibraryUpdatePermissions(
  client: ScixClient,
  input: In<typeof scixLibraryUpdatePermissionsSchema>
): Promise<ToolOut> {
  const id = libraryIdSegment(input.library_id);
  await client.post(`biblib/permissions/${id}`, { email: input.email, permission: input.permission });
  return {
    text: `Permission \`${input.permission}\` granted to ${input.email} on library \`${input.library_id}\`.`,
    structured: { library_id: input.library_id, email: input.email, permission: input.permission },
  };
}

export async function handleScixLibraryTransfer(
  client: ScixClient,
  input: In<typeof scixLibraryTransferSchema>,
  ctx?: ServerContext
): Promise<ToolOut | InputRequiredResult> {
  const id = libraryIdSegment(input.library_id);
  const gate = await confirmDestructive(client, ctx, id, (name, n) =>
    `Transfer ownership of library ${name}${papersOf(n)} to ${input.email}? You will lose ownership.`);
  if (gate === 'cancelled') return CANCELLED;
  if (gate !== 'proceed') return gate;

  await client.post(`biblib/transfer/${id}`, { email: input.email });
  return {
    text: `Library \`${input.library_id}\` transferred to ${input.email}.`,
    structured: { library_id: input.library_id, email: input.email, transferred: true },
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

  addTool(server, 'scix_library_edit', {
    title: 'Edit SciX library',
    description: 'Rename a SciX library or change its description or public/private visibility. ' +
      'Pass only the fields to change.',
    inputSchema: scixLibraryEditSchema,
    outputSchema: z.object({ library: libraryOut, updated: z.array(z.string()) }),
    annotations: MUTATE_REMOTE_IDEMPOTENT,
    icons: SCIX_ICONS,
  }, input => handleScixLibraryEdit(getScixClient(), input));

  addTool(server, 'scix_library_delete', {
    title: 'Delete SciX library',
    description: 'Permanently delete a SciX library and its notes. Cannot be undone. ' +
      'Clients that support elicitation are asked to confirm first.',
    inputSchema: scixLibraryDeleteSchema,
    outputSchema: z.object({ library_id: z.string(), deleted: z.boolean() }),
    annotations: DESTRUCTIVE_REMOTE,
    icons: SCIX_ICONS,
  }, (input, ctx) => handleScixLibraryDelete(getScixClient(), input, ctx));

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

  addTool(server, 'scix_library_add_by_query', {
    title: 'Add search results to library',
    description: 'Run a SciX search query and add its top results (up to "rows") to a library. ' +
      'Falls back to search-then-add when the query endpoint is unavailable.',
    inputSchema: scixLibraryAddByQuerySchema,
    outputSchema: z.object({
      library_id: z.string(), query: z.string(), requested: z.number(),
      found: z.number(), added: z.number(), via: z.enum(['query_endpoint', 'search_fallback']),
    }),
    annotations: MUTATE_REMOTE_IDEMPOTENT,
    icons: SCIX_ICONS,
  }, input => handleScixLibraryAddByQuery(getScixClient(), input));

  addTool(server, 'scix_library_operation', {
    title: 'Library set operation',
    description: 'Combine libraries (union, intersection, difference), copy a library, or empty it. ' +
      '"empty" removes every paper from the target library; clients that support elicitation are asked to confirm first.',
    inputSchema: scixLibraryOperationSchema,
    outputSchema: z.object({
      library_id: z.string(), operation: z.enum(['union', 'intersection', 'difference', 'copy', 'empty']),
      new_library_id: z.string().optional(), documents_affected: z.number().optional(),
    }),
    annotations: DESTRUCTIVE_REMOTE,
    icons: SCIX_ICONS,
  }, (input, ctx) => handleScixLibraryOperation(getScixClient(), input, ctx));

  addTool(server, 'scix_library_get_permissions', {
    title: 'Get library permissions',
    description: 'List who owns a SciX library and which collaborators have which permissions.',
    inputSchema: scixLibraryGetPermissionsSchema,
    outputSchema: z.object({
      library_id: z.string(), owner: z.string().optional(),
      collaborators: z.array(z.object({ email: z.string(), permissions: z.array(z.string()) })),
    }),
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixLibraryGetPermissions(getScixClient(), input));

  addTool(server, 'scix_library_update_permissions', {
    title: 'Update library permissions',
    description: 'Grant or change a collaborator\'s permission (owner, admin, write, read) on a SciX library.',
    inputSchema: scixLibraryUpdatePermissionsSchema,
    outputSchema: z.object({ library_id: z.string(), email: z.string(), permission: z.string() }),
    annotations: MUTATE_REMOTE_IDEMPOTENT,
    icons: SCIX_ICONS,
  }, input => handleScixLibraryUpdatePermissions(getScixClient(), input));

  addTool(server, 'scix_library_transfer', {
    title: 'Transfer library ownership',
    description: 'Transfer ownership of a SciX library to another user. You lose ownership. ' +
      'Clients that support elicitation are asked to confirm first.',
    inputSchema: scixLibraryTransferSchema,
    outputSchema: z.object({ library_id: z.string(), email: z.string(), transferred: z.boolean() }),
    annotations: DESTRUCTIVE_REMOTE,
    icons: SCIX_ICONS,
  }, (input, ctx) => handleScixLibraryTransfer(getScixClient(), input, ctx));

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
