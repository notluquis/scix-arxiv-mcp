import './stdout-guard.js';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildServer } from './server.js';

const handle = serveStdio(buildServer, {
  legacy: 'reject',
  onerror: (e) => {
    console.error('[scix-arxiv-mcp]', e.message);
    if (e.message.includes('2025-era')) {
      console.error('[scix-arxiv-mcp] client sent a 2025-era request; this server speaks only MCP 2026-07-28 (Claude Code >= 2.1.285, see README)');
    }
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void handle.close();
  });
}
