# research-remote-mcp

Remote MCP server that exposes NASA SciX / ADS and arXiv as tools for Claude (and any other MCP-compatible client that supports remote connectors).

## Why this exists

The original MCP servers for SciX and arXiv are excellent — but they run locally via stdio, which means they only work in desktop clients like Claude Desktop or the CLI. Claude on the web (claude.ai) connects to tools through **remote MCP servers** over HTTP. This project bridges that gap: it wraps both data sources behind a single Streamable HTTP endpoint you can deploy and point Claude at from Settings → Connectors.

```
claude.ai
  └── Custom Connector
        └── https://your-domain.com/mcp
              ├── SciX / NASA ADS   (peer-reviewed astronomy & astrophysics)
              └── arXiv             (preprints across all sciences)
```

## Tools

| Tool | Source | Description |
|------|--------|-------------|
| `scix_search` | SciX / ADS | Full-text + metadata search with Solr syntax |
| `scix_get_paper` | SciX / ADS | Full metadata + abstract by bibcode, arXiv ID, or DOI |
| `scix_get_citations` | SciX / ADS | Papers that cite or are cited by a given paper |
| `scix_get_metrics` | SciX / ADS | h-index, g-index, i10-index, citation counts |
| `arxiv_search` | arXiv | Search preprints with field prefixes (ti:, au:, abs:, cat:) |
| `arxiv_get_paper` | arXiv | Full metadata + abstract by arXiv ID |

## Architecture

```
app/
├── src/
│   ├── index.ts          # Express v5 + StreamableHTTPServerTransport (stateless)
│   ├── config.ts         # env vars
│   ├── formatters.ts     # markdown output
│   ├── clients/
│   │   ├── scix.ts       # HTTP client for ADS API
│   │   └── arxiv.ts      # HTTP client + Atom XML parser for arXiv
│   └── tools/            # one file per tool (schema + handler)
├── Dockerfile            # multi-stage node:22-alpine
└── railway.json

arxiv-mcp-server/         # reference source (Python, local/stdio)
scix-mcp/                 # reference source (TypeScript, local/stdio)
```

The server is **stateless** — a new MCP server instance is created per request. No sessions, no in-memory state. This keeps deployment simple and makes it trivially horizontally scalable.

## Setup

### 1. Get a SciX API token

Create an account at [scixplorer.org](https://scixplorer.org) and generate a token at `Settings → API Token`.

### 2. Environment variables

```bash
cp app/.env.example app/.env
# Set SCIX_API_TOKEN in .env
```

```env
SCIX_API_TOKEN=your_token_here   # required
PORT=3000                         # optional, default 3000
```

### 3. Run locally

```bash
pnpm install
pnpm -F research-remote-mcp dev
```

### 4. Deploy to Railway

Connect the repo in Railway, set `app/` as the root directory (or configure via `railway.json`), and add the `SCIX_API_TOKEN` environment variable. Railway will build the Docker image and publish a domain.

### 5. Add to Claude

In Claude → Settings → Connectors → Add custom connector:

```
https://your-domain.railway.app/mcp
```

## Development

```bash
# install all workspace packages
pnpm install

# build
pnpm -F research-remote-mcp build

# test (58 tests)
pnpm -F research-remote-mcp test

# test with coverage
pnpm -F research-remote-mcp test:coverage

# dev server (watch mode)
pnpm -F research-remote-mcp dev
```

## Tech stack

- **MCP SDK** `@modelcontextprotocol/sdk` — Streamable HTTP transport
- **Express v5** — HTTP server (async errors propagate automatically)
- **Zod v4** — schema validation and type inference
- **TypeScript 5.9** / Node.js 22
- **vitest** — tests

## Credits

This project is built on top of the work of:

**[scix-mcp](https://github.com/thostetler/scix-mcp)** by [Tim Hostetler](https://github.com/thostetler)
— TypeScript MCP server for the NASA Astrophysics Data System (SciX / ADS) API. The SciX client, tool schemas, API field definitions, and formatters in this project are adapted from his work.

**[arxiv-mcp-server](https://github.com/blazickjp/arxiv-mcp-server)** by [Joseph Blazick](https://github.com/blazickjp)
— Python MCP server for arXiv search and paper access. The arXiv tool design, query patterns, and category handling in this project are based on his implementation.

Both original projects are MIT-licensed and included here as reference source under `arxiv-mcp-server/` and `scix-mcp/`.

## License

MIT
