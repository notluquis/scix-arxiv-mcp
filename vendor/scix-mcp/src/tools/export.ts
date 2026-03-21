import { SciXAPIClient } from '../client.js';
import { ExportInput } from '../types.js';

export async function exportCitations(client: SciXAPIClient, input: ExportInput): Promise<string> {
  const toArray = <T>(value?: T | T[]): T[] | undefined => {
    if (value === undefined) return undefined;
    return Array.isArray(value) ? value : [value];
  };

  const {
    bibcodes,
    format,
    custom_format,
    sort,
    maxauthor,
    authorcutoff,
    journalformat,
    keyformat
  } = input;

  const data: Record<string, any> = {
    bibcode: bibcodes
  };

  const sortArr = toArray(sort);
  const maxAuthorArr = toArray(maxauthor);
  const authorCutoffArr = toArray(authorcutoff);
  const journalFormatArr = toArray(journalformat);
  const keyFormatArr = toArray(keyformat);

  if (sortArr) data.sort = sortArr;
  if (maxAuthorArr) data.maxauthor = maxAuthorArr;
  if (authorCutoffArr) data.authorcutoff = authorCutoffArr;
  if (journalFormatArr) data.journalformat = journalFormatArr;
  if (keyFormatArr) data.keyformat = keyFormatArr;
  if (format === 'custom' && custom_format) data.format = custom_format;

  const response = await client.post(`export/${format}`, data);

  return response.export || '';
}
