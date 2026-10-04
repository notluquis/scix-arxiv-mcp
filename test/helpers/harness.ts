import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { buildServer } from '../../src/server.js';

export interface ConnectOptions {
  /** Declare the elicitation (form) client capability. */
  elicitation?: boolean;
}

/**
 * In-process MCP 2026-07-28 connection: real client, real handler, no sockets.
 * The fetch is passed explicitly, so a mocked global.fetch (arXiv/ADS) never reaches the MCP transport.
 */
export async function connect(opts?: ConnectOptions) {
  const handler = createMcpHandler(buildServer, { legacy: 'reject' });
  const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client(
    { name: 'test', version: '0' },
    {
      versionNegotiation: { mode: { pin: '2026-07-28' } },
      capabilities: opts?.elicitation ? { elicitation: { form: {} } } : {},
    }
  );
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close();
      await handler.close();
    },
  };
}
