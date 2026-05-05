import { z } from 'zod';
import { ScixClient } from '../clients/scix.js';

const EXPORT_FORMATS = [
  'bibtex', 'bibtexabs', 'ris', 'endnote', 'aastex', 'ads', 'agu', 'ams',
  'custom', 'dcxml', 'gsa', 'icarus', 'ieee', 'jatsxml', 'medlars', 'mnras',
  'procite', 'refabsxml', 'refworks', 'refxml', 'rss', 'soph', 'votable',
] as const;

export const scixExportSchema = {
  bibcodes: z.array(z.string().min(1)).min(1).max(2000).describe(
    'List of SciX/ADS bibcodes to export (max 2000)'
  ),
  format: z.enum(EXPORT_FORMATS).default('bibtex').describe(
    'Export format. Common: "bibtex" (BibTeX), "bibtexabs" (BibTeX + abstract), ' +
    '"ris" (Reference Manager / Zotero / Mendeley), "endnote" (EndNote), ' +
    '"aastex" (AASTeX LaTeX), "ieee" (IEEE), "mnras" (MNRAS). ' +
    'Use "custom" with custom_format for a template-based format.'
  ),
  custom_format: z.string().optional().describe(
    'Custom format template string (only used when format="custom")'
  ),
  sort: z.string().optional().describe(
    'Sort order for the exported bibliography, e.g. "date desc"'
  ),
  maxauthor: z.number().int().optional().describe(
    'Maximum number of authors to list before truncating to et al.'
  ),
  authorcutoff: z.number().int().optional().describe(
    'Author cutoff threshold before applying truncation'
  ),
  journalformat: z.number().int().min(1).max(4).optional().describe(
    'Journal abbreviation style: 1=AASTeX, 2=Icarus, 3=MNRAS, 4=SOPH'
  ),
  keyformat: z.string().optional().describe(
    'Citation key format template for export formats that support custom keys'
  ),
};

export type ScixExportInput = z.infer<z.ZodObject<typeof scixExportSchema>>;

export async function handleScixExport(
  client: ScixClient,
  input: ScixExportInput
): Promise<string> {
  const body: Record<string, unknown> = { bibcode: input.bibcodes };

  if (input.sort) body['sort'] = [input.sort];
  if (input.maxauthor != null) body['maxauthor'] = [input.maxauthor];
  if (input.authorcutoff != null) body['authorcutoff'] = [input.authorcutoff];
  if (input.journalformat != null) body['journalformat'] = [input.journalformat];
  if (input.keyformat) body['keyformat'] = [input.keyformat];
  if (input.format === 'custom' && input.custom_format) body['format'] = input.custom_format;

  const data = await client.post(`export/${input.format}`, body) as { export?: string };
  return data.export ?? '';
}
