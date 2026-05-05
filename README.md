# research-remote-mcp

Remote MCP server that exposes NASA SciX / ADS and arXiv as tools for Claude (and any other MCP-compatible client that supports remote connectors).

## Why this exists

The original MCP servers for SciX and arXiv are excellent — but they run locally via stdio, which means they only work in desktop clients like Claude Desktop or the CLI. Claude on the web (claude.ai) connects to tools through **remote MCP servers** over HTTP. This project bridges that gap: it wraps both data sources behind a single Streamable HTTP endpoint you can deploy and point Claude at from Settings → Connectors.

```
claude.ai
  └── Custom Connector
        └── https://your-domain.com/mcp
              ├── SciX / NASA ADS   (peer-reviewed astronomy, astrophysics, planetary science)
              └── arXiv             (preprints across all sciences)
```

## Tools

### SciX / NASA ADS

| Tool | Description |
|------|-------------|
| `scix_search` | Full-text + metadata search with Solr syntax; returns bibcodes, titles, authors, citation counts |
| `scix_get_paper` | Full metadata + abstract by bibcode, arXiv ID, or DOI |
| `scix_search_docs` | Search SciX help docs, search syntax, and usage guides |
| `scix_get_citations` | Papers that cite or are cited by a given paper |
| `scix_get_metrics` | h-index, g-index, i10-index, m-index, tori, total/refereed citations, reads |
| `scix_export` | Export bibliography in BibTeX, RIS, AASTeX, IEEE, MNRAS, and 18+ other formats |
| `scix_find_similar` | Find papers with similar content to a given bibcode using SciX's `similar()` operator |
| `scix_library_list` | List your personal SciX libraries (saved paper collections) |
| `scix_library_get` | Get contents and metadata of a specific library |
| `scix_library_create` | Create a new personal library |
| `scix_library_documents` | Add or remove papers from a library |
| `scix_library_note` | Get, set, or delete personal annotation notes on papers in a library |

### arXiv

| Tool | Description |
|------|-------------|
| `arxiv_search` | Search preprints with field prefixes (`ti:`, `au:`, `abs:`, `cat:`), date ranges, and category filters |
| `arxiv_get_paper` | Full metadata + abstract by arXiv ID; returns links to PDF and HTML versions |
| `arxiv_read_paper` | Extract text from arXiv HTML or source archive; supports `offset`/`max_chars` pagination for long papers |
| `arxiv_download_paper` | Download a paper from arXiv and extract PDF text; supports `offset`/`max_chars` pagination |
| `arxiv_citation_graph` | Get citing and referenced papers for an arXiv ID from Semantic Scholar |

### Prompts

| Prompt | Description |
|--------|-------------|
| `research_discovery` | Explore a topic: find influential papers, key authors, open questions |
| `deep_paper_analysis` | Deep analysis of a specific paper: methodology, results, limitations, context |
| `summarize_paper` | Concise structured summary of one paper |
| `compare_papers` | Side-by-side comparison across arXiv papers |
| `literature_review` | Structured literature review for a topic and optional paper set |
| `literature_synthesis` | Synthesize findings across multiple papers into a state-of-the-art review |

## Architecture

```
src/
├── index.ts          # Hono + StreamableHTTPServerTransport (stateless)
├── config.ts         # env vars
├── formatters.ts     # shared markdown output helpers
├── clients/
│   ├── scix.ts       # HTTP client for ADS API (singleton)
│   ├── arxiv.ts      # HTTP client + Atom XML parser + full-text extraction helpers for arXiv
│   └── scix_docs.ts  # SciX documentation search index
└── tools/            # one file per tool (schema + handler)

test/                 # vitest tests
data/
└── scix/
    └── chunked-index.json # generated SciX docs search index

Dockerfile            # multi-stage node:22-alpine
railway.json          # Railway deployment config
```

The server is **stateless** — a new MCP server instance is created per request. No sessions, no in-memory state. This keeps deployment simple and makes horizontal scaling trivial. The MCP endpoint supports Streamable HTTP over `GET /mcp` and `POST /mcp`.

## Why Hono

Hono replaced Express v5 as the HTTP layer because:

- **Native `HttpBindings`** — Hono's `@hono/node-server` exposes the raw Node.js `IncomingMessage` and `ServerResponse` objects that MCP's `StreamableHTTPServerTransport` needs directly, with no adapter layer
- **`RESPONSE_ALREADY_SENT` sentinel** — cleanly tells Hono not to write its own response after the MCP transport hijacks the socket for SSE streaming
- **Zero overhead** — Hono adds no middleware stack, just routes; appropriate for a tight service with two endpoints

## Setup

### 1. Get a SciX API token

Create an account at [scixplorer.org](https://scixplorer.org) and generate a token at `Settings → API Token`.

### 2. Environment variables

```env
SCIX_API_TOKEN=your_token_here   # required
PORT=3000                         # optional, default 3000
MCP_BEARER_TOKEN=secret           # optional, require Authorization: Bearer secret for /mcp
MCP_ALLOWED_ORIGINS=https://app.example.com,https://claude.ai  # optional exact Origin allowlist
MCP_RESOURCE_URL=https://your-domain.railway.app/mcp  # optional canonical MCP resource URL
MCP_AUTHORIZATION_SERVERS=https://auth.example.com     # optional OAuth authorization server metadata issuer(s)
MCP_AUTH_SCOPES=research:read,research:write           # optional scopes for WWW-Authenticate challenges
```

Requests without an `Origin` header are allowed for server-to-server MCP clients. Requests with an `Origin` header must match `MCP_ALLOWED_ORIGINS`; when the allowlist is unset, only localhost origins are accepted for local development. Set explicit origins in production when using browser-based clients.

`MCP_BEARER_TOKEN` is a simple private-deployment guard. For OAuth-compatible deployments, set `MCP_RESOURCE_URL` and `MCP_AUTHORIZATION_SERVERS`; the server will expose OAuth Protected Resource Metadata at `/.well-known/oauth-protected-resource` and include `resource_metadata` in `WWW-Authenticate` responses.

### 3. Run locally

```bash
npm install
npm run dev
```

### 4. Deploy to Railway

Connect the repo in Railway and add the `SCIX_API_TOKEN` environment variable. Railway picks up `railway.json` and builds from the root-level `Dockerfile` automatically.

After deploy, check `/health`; it returns the server version and deployment commit when Railway exposes `RAILWAY_GIT_COMMIT_SHA`.

### 5. Add to Claude

In Claude → Settings → Connectors → Add custom connector:

```
https://your-domain.railway.app/mcp
```

## Development

```bash
pnpm install          # install deps
pnpm build            # TypeScript → build/
pnpm test             # run the test suite
pnpm test:watch       # watch mode
pnpm dev              # watch + run (tsx)
```

## Tech stack

- **Hono** + `@hono/node-server` — HTTP server with native Node.js bindings
- **MCP SDK** `@modelcontextprotocol/sdk` — Streamable HTTP transport (stateless)
- **Zod v4** — schema validation and type inference
- **TypeScript 6.0** / Node.js 22
- **vitest** — test suite across all tools and clients

## Credits

This project is built on top of the work of:

**[scix-mcp](https://github.com/thostetler/scix-mcp)** by [Tim Hostetler](https://github.com/thostetler)
— TypeScript MCP server for the NASA Astrophysics Data System (SciX / ADS) API. The SciX client, tool schemas, API field definitions, and formatters in this project are adapted from his work.

**[arxiv-mcp-server](https://github.com/blazickjp/arxiv-mcp-server)** by [Joseph Blazick](https://github.com/blazickjp)
— Python MCP server for arXiv search and paper access. The arXiv tool design, query patterns, and category handling in this project are based on his implementation.

`scix-mcp` is MIT-licensed. `arxiv-mcp-server` is Apache-2.0-licensed. This repo does not vendor those upstream projects; it keeps only the generated SciX docs search index under `data/scix/`.

## License

MIT
