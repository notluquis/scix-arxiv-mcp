import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  PROTOCOL_VERSION_META_KEY, type McpServer, type ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ScixApiError, getScixClient } from '../clients/scix.js';
import { getScixApiKey } from '../config.js';
import { cacheDir, stateDir } from '../cache.js';
import { READ_EXTERNAL, addTool, registeredToolCount, responseFormat, type ToolOut } from '../content.js';
import { SCIX_ICONS } from '../icons.js';

const require = createRequire(import.meta.url);

/** The SDK's `exports` map hides its package.json, so walk up from its entry point to find it. */
async function sdkVersion(): Promise<string> {
  try {
    let dir = path.dirname(require.resolve('@modelcontextprotocol/server'));
    for (let i = 0; i < 5; i++, dir = path.dirname(dir)) {
      const pkg = await fs.readFile(path.join(dir, 'package.json'), 'utf8').catch(() => undefined);
      if (!pkg) continue;
      const parsed = JSON.parse(pkg) as { name?: string; version?: string };
      if (parsed.name === '@modelcontextprotocol/server') return parsed.version ?? 'unknown';
    }
  } catch {
    // fall through
  }
  return 'unknown';
}

export const healthCheckSchema = z.object({ response_format: responseFormat });

type ProbeState = 'ok' | 'unauthorized' | 'rate_limited' | 'unreachable' | 'skipped';

interface Probe {
  state: ProbeState;
  message?: string;
  reset_at?: string;
}

/** The token is only ever tested for presence; its value never leaves this module. */
function tokenConfigured(): boolean {
  try {
    getScixApiKey();
    return true;
  } catch {
    return false;
  }
}

export function classifyProbeError(e: unknown): Probe {
  if (e instanceof ScixApiError) {
    if (e.status === 401) return { state: 'unauthorized', message: 'ADS rejected the token (HTTP 401)' };
    if (e.status === 429) return { state: 'rate_limited', message: 'ADS rate limit reached (HTTP 429)' };
    return { state: 'unreachable', message: `ADS answered HTTP ${e.status}` };
  }
  const message = e instanceof Error ? e.message : String(e);
  // fetchWithPolicy refuses to sleep past MAX_WAIT_MS and says when to retry instead.
  const limited = /HTTP 429\); retry after (\S+?)\.?$/.exec(message);
  if (limited) return { state: 'rate_limited', message, reset_at: limited[1] };
  return { state: 'unreachable', message };
}

async function probeAds(): Promise<Probe> {
  if (!tokenConfigured()) return { state: 'skipped', message: 'no token configured' };
  try {
    await getScixClient().get('search/query', { q: '*:*', rows: 1, fl: 'id' });
    return { state: 'ok' };
  } catch (e) {
    return classifyProbeError(e);
  }
}

/** Checks the nearest existing ancestor, so a health check never creates directories. */
async function dirStatus(dir: string) {
  let probe = dir;
  let exists = true;
  for (;;) {
    try {
      await fs.access(probe, fs.constants.W_OK);
      return { path: dir, exists: probe === dir && exists, writable: true };
    } catch {
      const stat = await fs.stat(probe).catch(() => undefined);
      if (stat) return { path: dir, exists: probe === dir, writable: false };
      const parent = path.dirname(probe);
      if (parent === probe) return { path: dir, exists: false, writable: false };
      probe = parent;
      exists = false;
    }
  }
}

const dirOut = z.object({ path: z.string(), exists: z.boolean(), writable: z.boolean() });

export const healthOutput = z.object({
  server: z.object({ name: z.string(), version: z.string(), sdk_version: z.string() }),
  protocol: z.string(),
  scix_token_configured: z.boolean(),
  ads_probe: z.object({
    state: z.enum(['ok', 'unauthorized', 'rate_limited', 'unreachable', 'skipped']),
    message: z.string().optional(),
    reset_at: z.string().optional(),
  }),
  cache_dir: dirOut,
  state_dir: dirOut,
  tool_count: z.number(),
});

export async function handleHealthCheck(ctx: ServerContext | undefined, toolCount: number): Promise<ToolOut> {
  const envelope = ctx?.mcpReq.envelope as Record<string, unknown> | undefined;
  const protocol = envelope?.[PROTOCOL_VERSION_META_KEY];
  const pkg = require('../../package.json') as { name: string; version: string };

  const report = {
    server: { name: pkg.name, version: pkg.version, sdk_version: await sdkVersion() },
    protocol: typeof protocol === 'string' ? protocol : 'unknown',
    scix_token_configured: tokenConfigured(),
    ads_probe: await probeAds(),
    cache_dir: await dirStatus(cacheDir()),
    state_dir: await dirStatus(stateDir()),
    tool_count: toolCount,
  };

  const yn = (b: boolean) => (b ? 'yes' : 'no');
  const probe = report.ads_probe;
  let text = `# scix-arxiv-mcp health\n\n`;
  text += `- **Server:** ${report.server.name} ${report.server.version} (MCP SDK ${report.server.sdk_version})\n`;
  text += `- **Protocol:** ${report.protocol}\n`;
  text += `- **SciX token configured:** ${yn(report.scix_token_configured)}\n`;
  text += `- **ADS probe:** ${probe.state}${probe.message ? ` (${probe.message})` : ''}${probe.reset_at ? `, resets ${probe.reset_at}` : ''}\n`;
  for (const [label, d] of [['Cache', report.cache_dir], ['State', report.state_dir]] as const) {
    text += `- **${label} dir:** ${d.path} (exists: ${yn(d.exists)}, writable: ${yn(d.writable)})\n`;
  }
  text += `- **Tools:** ${report.tool_count}\n`;
  if (!report.scix_token_configured) {
    text += `\nSciX tools need SCIX_API_TOKEN: run /plugin → scix-arxiv → configure, or get a token at https://scixplorer.org/user/settings/token\n`;
  }
  return { text, structured: report };
}

export function registerHealthTool(server: McpServer): void {
  addTool(server, 'health_check', {
    title: 'Server health check',
    description:
      'Report server and SDK versions, the MCP protocol in use, whether a SciX token is configured ' +
      '(never its value), an ADS reachability probe, cache/state directory status and the tool count. ' +
      'Makes no arXiv request.',
    inputSchema: healthCheckSchema,
    outputSchema: healthOutput,
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, (_input, ctx) => handleHealthCheck(ctx, registeredToolCount(server)));
}
