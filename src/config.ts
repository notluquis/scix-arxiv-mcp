export const SCIX_API_BASE = 'https://api.adsabs.harvard.edu/v1';
export const REQUEST_TIMEOUT = 30_000;

export const DEFAULT_FIELDS = [
  'bibcode', 'title', 'author', 'year', 'pubdate',
  'abstract', 'citation_count', 'read_count',
  'doi', 'arxiv_id', 'pub', 'volume', 'page', 'keyword', 'identifier'
].join(',');

/**
 * A secret from the environment, or undefined. Empty values and an unsubstituted
 * `${user_config.*}` placeholder (a plugin option the user never set) both count as unset,
 * so the placeholder is never sent to an API as a key.
 */
export function envSecret(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && !/^\$\{[^}]*\}$/.test(v) ? v : undefined;
}

export function getScixApiKey(): string {
  const key = envSecret('SCIX_API_TOKEN');
  if (!key) {
    throw new Error(
      'SCIX_API_TOKEN is not set. In Claude Code run /plugin → scix-arxiv → configure, or get a token at https://scixplorer.org/user/settings/token'
    );
  }
  return key;
}

export const ARXIV_API_URL = 'https://export.arxiv.org/api/query';
export const ARXIV_MAX_RESULTS = parseInt(process.env.ARXIV_MAX_RESULTS ?? '10', 10);
