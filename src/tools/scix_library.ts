import { z } from 'zod';
import { ScixClient } from '../clients/scix.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

export const scixLibraryListSchema = {
  filter: z.enum(['all', 'owner', 'collaborator']).default('all').describe(
    'Filter libraries by access type'
  ),
};

export const scixLibraryGetSchema = {
  library_id: z.string().min(1).describe('Library identifier (from scix_library_list)'),
};

export const scixLibraryCreateSchema = {
  name: z.string().min(1).max(255).describe('Library name'),
  description: z.string().max(1000).optional().describe('Library description'),
  public: z.boolean().default(false).describe('Whether the library is publicly visible'),
  bibcodes: z.array(z.string()).optional().describe('Initial papers to add (bibcodes)'),
};

export const scixLibraryDocumentsSchema = {
  library_id: z.string().min(1).describe('Library identifier'),
  bibcodes: z.array(z.string().min(1)).min(1).max(2000).describe('Bibcodes to add or remove'),
  action: z.enum(['add', 'remove']).describe('Whether to add or remove the papers'),
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScixLibraryListInput = z.infer<z.ZodObject<typeof scixLibraryListSchema>>;
export type ScixLibraryGetInput = z.infer<z.ZodObject<typeof scixLibraryGetSchema>>;
export type ScixLibraryCreateInput = z.infer<z.ZodObject<typeof scixLibraryCreateSchema>>;
export type ScixLibraryDocumentsInput = z.infer<z.ZodObject<typeof scixLibraryDocumentsSchema>>;

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

export async function handleScixLibraryList(
  client: ScixClient,
  input: ScixLibraryListInput
): Promise<string> {
  const params = input.filter !== 'all' ? { access_type: input.filter } : undefined;
  const data = await client.get('biblib/libraries', params) as { libraries?: LibraryMeta[] };
  const libs = data.libraries ?? [];

  if (libs.length === 0) return 'No libraries found.';

  let out = `# Libraries (${libs.length})\n\n`;
  for (const lib of libs) {
    out += `## ${lib.name}\n`;
    out += `- **ID:** \`${lib.id}\`\n`;
    if (lib.description) out += `- **Description:** ${lib.description}\n`;
    out += `- **Papers:** ${lib.num_documents}  |  **Permission:** ${lib.permission}  |  **Public:** ${lib.public ? 'Yes' : 'No'}\n`;
    out += `- **Owner:** ${lib.owner}  |  **Modified:** ${lib.date_last_modified.slice(0, 10)}\n\n`;
  }
  return out;
}

export async function handleScixLibraryGet(
  client: ScixClient,
  input: ScixLibraryGetInput
): Promise<string> {
  const data = await client.get(`biblib/libraries/${input.library_id}`) as {
    metadata?: LibraryMeta;
    documents?: string[];
  } & Partial<LibraryMeta>;

  const meta: Partial<LibraryMeta> = data.metadata ?? data;
  const docs = data.documents ?? [];

  if (!meta?.name) return `Library ${input.library_id} not found or empty response.`;

  let out = `# ${meta.name}\n\n`;
  out += `- **ID:** \`${meta.id}\`\n`;
  if (meta.description) out += `- **Description:** ${meta.description}\n`;
  out += `- **Papers:** ${meta.num_documents}  |  **Permission:** ${meta.permission}  |  **Public:** ${meta.public ? 'Yes' : 'No'}\n`;
  out += `- **Owner:** ${meta.owner}\n\n`;

  if (docs.length > 0) {
    out += `## Papers (${docs.length})\n\n`;
    docs.forEach((bib, i) => { out += `${i + 1}. \`${bib}\`\n`; });
  }

  return out;
}

export async function handleScixLibraryCreate(
  client: ScixClient,
  input: ScixLibraryCreateInput
): Promise<string> {
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
  return out;
}

export async function handleScixLibraryDocuments(
  client: ScixClient,
  input: ScixLibraryDocumentsInput
): Promise<string> {
  const data = await client.post(`biblib/documents/${input.library_id}`, {
    bibcode: input.bibcodes,
    action: input.action,
  }) as { number_added?: number; number_removed?: number };

  const changed = data.number_added ?? data.number_removed ?? input.bibcodes.length;
  const verb = input.action === 'add' ? 'Added' : 'Removed';
  return `${verb} ${changed} paper(s) ${input.action === 'add' ? 'to' : 'from'} library \`${input.library_id}\`.`;
}
