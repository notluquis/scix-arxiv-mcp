import { afterEach, describe, expect, it, vi } from 'vitest';
import { connect } from '../helpers/harness.js';
import { mockFetch, mockFetchError } from '../helpers/mockFetch.js';

const SECRET = 'super-secret-ads-token-123';

async function health(args: Record<string, unknown> = {}) {
  const c = await connect();
  try {
    const result = await c.client.callTool({ name: 'health_check', arguments: args });
    const text = (result.content as { text: string }[])[0].text;
    return { result, text, report: result.structuredContent as Record<string, any> };
  } finally {
    await c.close();
  }
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('health_check', () => {
  it('without a token: configured=no, probe skipped, no ADS request, protocol via the meta-key', async () => {
    vi.stubEnv('SCIX_API_TOKEN', '');
    const fetchMock = mockFetch();
    const { report, text } = await health();

    expect(report.scix_token_configured).toBe(false);
    expect(report.semantic_scholar_key_configured).toBe(false);
    expect(report.ads_probe.state).toBe('skipped');
    expect(report.protocol).toBe('2026-07-28');
    expect(report.tool_count).toBe(39);
    expect(report.server.name).toBe('scix-arxiv-mcp');
    expect(report.server.sdk_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text).toContain('SciX token configured:** no');
  });

  it('reports the Semantic Scholar key as configured without printing it; the placeholder counts as unset', async () => {
    vi.stubEnv('SEMANTIC_SCHOLAR_API_KEY', 's2-secret-value');
    let { report, text } = await health();
    expect(report.semantic_scholar_key_configured).toBe(true);
    expect(text).not.toContain('s2-secret-value');
    vi.stubEnv('SEMANTIC_SCHOLAR_API_KEY', '${user_config.semantic_scholar_api_key}');
    ({ report } = await health());
    expect(report.semantic_scholar_key_configured).toBe(false);
  });

  it('with a token: probes search/query once and never prints the token', async () => {
    vi.stubEnv('SCIX_API_TOKEN', SECRET);
    const fetchMock = mockFetch({ body: { response: { docs: [] } } });
    const { report, text, result } = await health();

    expect(report.scix_token_configured).toBe(true);
    expect(report.ads_probe).toEqual({ state: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('search/query');
    expect(String(url)).toContain('rows=1');
    expect(new URL(String(url)).hostname).toBe('api.adsabs.harvard.edu');
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(text).not.toContain(SECRET);
    expect((init?.headers as Record<string, string>).Authorization).toContain(SECRET); // sent upstream, never reported
  });

  it('classifies unauthorized, rate_limited (with reset time) and unreachable', async () => {
    vi.stubEnv('SCIX_API_TOKEN', SECRET);

    mockFetch({ status: 401, text: 'bad token' });
    expect((await health()).report.ads_probe.state).toBe('unauthorized');

    mockFetch({ status: 429, headers: { 'retry-after': '3600' }, text: 'slow down' });
    const limited = (await health()).report.ads_probe;
    expect(limited.state).toBe('rate_limited');
    expect(limited.reset_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    mockFetchError('getaddrinfo ENOTFOUND');
    const down = (await health()).report.ads_probe;
    expect(down.state).toBe('unreachable');
    expect(JSON.stringify(down)).not.toContain(SECRET);
  });

  it('reports cache and state directories and honours response_format json', async () => {
    vi.stubEnv('SCIX_API_TOKEN', '');
    const { text, report } = await health({ response_format: 'json' });
    expect(JSON.parse(text)).toEqual(report);
    expect(report.cache_dir).toMatchObject({ writable: true });
    expect(report.state_dir).toMatchObject({ writable: true });
  });
});
