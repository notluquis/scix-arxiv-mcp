export const PORT = parseInt(process.env.PORT ?? '3000', 10);
export const SERVER_VERSION = process.env.npm_package_version ?? '1.0.0';
export const BUILD_COMMIT = (
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  process.env.GIT_COMMIT_SHA ??
  process.env.SOURCE_VERSION ??
  ''
).trim();

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

export const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN?.trim() || undefined;
export const MCP_ALLOWED_ORIGINS = (process.env.MCP_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
export const MCP_RESOURCE_URL = process.env.MCP_RESOURCE_URL?.trim().replace(/\/$/, '') || undefined;
export const MCP_AUTHORIZATION_SERVERS = (process.env.MCP_AUTHORIZATION_SERVERS ?? '')
  .split(',')
  .map(url => url.trim().replace(/\/$/, ''))
  .filter(Boolean);
export const MCP_AUTH_SCOPES = (process.env.MCP_AUTH_SCOPES ?? '')
  .split(/[,\s]+/)
  .map(scope => scope.trim())
  .filter(Boolean);
