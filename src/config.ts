export const PORT = parseInt(process.env.PORT ?? '3000', 10);

export const SCIX_API_BASE = 'https://api.adsabs.harvard.edu/v1';
export const REQUEST_TIMEOUT = 30_000;

export const DEFAULT_FIELDS = [
  'bibcode', 'title', 'author', 'year', 'pubdate',
  'abstract', 'citation_count', 'read_count',
  'doi', 'arxiv_id', 'pub', 'volume', 'page', 'keyword', 'identifier'
].join(',');

export function getScixApiKey(): string {
  const key = process.env.SCIX_API_TOKEN;
  if (!key?.trim()) {
    throw new Error(
      'SCIX_API_TOKEN is not set. Get yours at https://scixplorer.org/user/settings/token'
    );
  }
  return key.trim();
}

export const ARXIV_API_URL = 'https://export.arxiv.org/api/query';
export const ARXIV_MAX_RESULTS = parseInt(process.env.ARXIV_MAX_RESULTS ?? '10', 10);
