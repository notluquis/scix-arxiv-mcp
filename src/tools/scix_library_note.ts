import { z } from 'zod';
import { ScixClient } from '../clients/scix.js';

export const scixLibraryNoteSchema = {
  library_id: z.string().min(1).describe('Library identifier'),
  bibcode: z.string().min(1).max(19).describe('Bibcode of the paper to annotate'),
  action: z.enum(['get', 'set', 'delete']).describe(
    '"get" retrieves the note, "set" creates or updates it, "delete" removes it'
  ),
  content: z.string().min(1).max(10000).optional().describe(
    'Note content (required for action="set")'
  ),
};

export type ScixLibraryNoteInput = z.infer<z.ZodObject<typeof scixLibraryNoteSchema>>;

export async function handleScixLibraryNote(
  client: ScixClient,
  input: ScixLibraryNoteInput
): Promise<string> {
  const endpoint = `biblib/libraries/${input.library_id}/notes/${input.bibcode}`;

  if (input.action === 'get') {
    const data = await client.get(endpoint) as {
      content?: string;
      date_created?: string;
      date_last_modified?: string;
    };

    if (!data.content) return `No note found for \`${input.bibcode}\` in library \`${input.library_id}\`.`;

    let out = `# Note for \`${input.bibcode}\`\n\n`;
    out += data.content + '\n\n';
    if (data.date_last_modified) out += `*Last updated: ${data.date_last_modified.slice(0, 10)}*\n`;
    return out;
  }

  if (input.action === 'set') {
    if (!input.content) return 'Error: content is required for action="set"';
    await client.post(endpoint, { content: input.content });
    return `Note saved for \`${input.bibcode}\` in library \`${input.library_id}\`.`;
  }

  // delete
  await client.delete(endpoint);
  return `Note deleted for \`${input.bibcode}\` in library \`${input.library_id}\`.`;
}
