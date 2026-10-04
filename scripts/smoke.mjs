// Authoritative stdio check: spawns build/index.js and talks MCP 2026-07-28 to it.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const EXPECTED_TOOLS = 22;
const EXPECTED_PROMPTS = 6;

const client = new Client(
  { name: 'smoke', version: '0' },
  { versionNegotiation: { mode: { pin: '2026-07-28' } } }
);

try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['build/index.js'],
      env: { ...process.env, SCIX_API_TOKEN: '' },
      stderr: 'inherit',
    })
  );
  const era = client.getProtocolEra();
  if (era !== 'modern') throw new Error(`protocol era is ${era}, expected modern`);
  const { tools } = await client.listTools();
  if (tools.length !== EXPECTED_TOOLS) throw new Error(`expected ${EXPECTED_TOOLS} tools, got ${tools.length}`);
  const { prompts } = await client.listPrompts();
  if (prompts.length !== EXPECTED_PROMPTS) throw new Error(`expected ${EXPECTED_PROMPTS} prompts, got ${prompts.length}`);
  console.error(`smoke ok: era=${era} tools=${tools.length} prompts=${prompts.length}`);
  await client.close();
} catch (e) {
  console.error('smoke FAILED:', e);
  process.exitCode = 1;
  await client.close().catch(() => {});
}
