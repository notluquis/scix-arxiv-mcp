# scix-arxiv-mcp

Local stdio MCP server that exposes NASA SciX / ADS and arXiv as tools for Claude Code. It speaks only MCP protocol 2026-07-28 (requires Claude Code >= 2.1.285); a 2025-era client is rejected with JSON-RPC error -32022.

Set `SCIX_API_TOKEN` (get one at https://scixplorer.org/user/settings/token) for the SciX tools; arXiv tools need no token.

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

## Development

```bash
pnpm install
pnpm build       # tsc -> build/
pnpm typecheck   # src + tests
pnpm test
pnpm smoke       # spawns build/index.js and talks 2026-07-28 over stdio
```

Stdout carries the protocol: log to stderr only (`src/stdout-guard.ts` redirects `console.log`).

## Tech stack

- `@modelcontextprotocol/server` 2.x, stdio (`serveStdio`, legacy openings rejected)
- Zod v4, TypeScript 7 (native `tsc`), Node 24+, vitest 5

## Credits

This project is built on top of the work of:

**[scix-mcp](https://github.com/thostetler/scix-mcp)** by [Tim Hostetler](https://github.com/thostetler)
— TypeScript MCP server for the NASA Astrophysics Data System (SciX / ADS) API. The SciX client, tool schemas, API field definitions, and formatters in this project are adapted from his work.

**[arxiv-mcp-server](https://github.com/blazickjp/arxiv-mcp-server)** by [Joseph Blazick](https://github.com/blazickjp)
— Python MCP server for arXiv search and paper access. The arXiv tool design, query patterns, and category handling in this project are based on his implementation.

`scix-mcp` is MIT-licensed. `arxiv-mcp-server` is Apache-2.0-licensed. This repo does not vendor those upstream projects; it keeps only the generated SciX docs search index under `data/scix/`.

## License

MIT
