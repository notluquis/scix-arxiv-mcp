# NASA SciX MCP Server

A Model Context Protocol (MCP) server for the NASA Astrophysics Data System (SciX) API. This server enables LLMs to search astronomical literature, retrieve paper metadata, analyze citation metrics, and export bibliographic data.

## Quick Start (MCP clients)

### Get an API Key

1. Create an account at [SciX](https://scixplorer.org/)
2. Generate an API token at https://scixplorer.org/user/settings/token
3. Set the environment variable:

```bash
export SCIX_API_TOKEN=your_api_key_here
```

Or create a `.env` file:

```bash
cp .env.example .env
# Edit .env and add your key
```

### Configure your MCP client (Claude, Codex, etc.)

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "ads": {
      "command": "npx",
      "args": ["scix-mcp"],
      "env": {
        "SCIX_API_TOKEN": "your_api_key_here"
      }
    }
  }
}
```

Common locations: Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%AppData%\\Claude\\claude_desktop_config.json` on Windows) and Codex CLI (`~/.config/codex/config.json`). Restart your client after editing.

Local MCP clients that read `.mcp/server.json` can also pick up the packaged config in `.mcp/server.json`; just drop in your `SCIX_API_TOKEN`.

## Example Prompts

```text
- Find refereed JWST exoplanet papers from 2022-2024 sorted by citation_count, return the top 5 in markdown with bibcodes, titles, first author, and citation counts.
- Build a query for gravitational wave kilonova follow-ups since 2017 (fielded abstract search), add the first 50 results to library <library_id>, and then give me metrics (h-index, total cites) for those bibcodes in JSON.
- Fetch paper 2020ApJ...905....3A, list its first 10 references with titles, and also list the first 10 forward citations with publication years.
- Create a public library named “Cosmic Web Reviews”, seeded with bibcodes [...], then share the public URL and export the contents in BibTeX.
- For bibcodes [...], return citation metrics plus a ranked list of which papers cite the most recent one (rows=25) in markdown.
- Get all my libraries, pick the one with the most documents, and return its metadata plus the first 5 document titles in JSON.
```

## Features

- **Literature Search**: Full-text search with advanced Solr query syntax
- **Paper Details**: Retrieve comprehensive metadata for any publication
- **Citation Metrics**: Calculate h-index, citation counts, and usage statistics
- **Citation Network**: Explore forward and backward citations
- **Export**: Generate citations in BibTeX, AASTeX, EndNote, and MEDLARS formats
- **Documentation Search**: Query SciX help/docs content via the `search_docs` tool
- **Dual Format**: Support for both human-readable Markdown and machine-readable JSON

## Available Tools

### Search & Metadata

- `search`: Solr-powered search across SciX. Params: `query` (required), `rows` (1-100, default 10), `start` (offset, default 0), `sort` (`score desc` | `citation_count desc` | `date desc` | `date asc` | `read_count desc`, default `score desc`), `response_format` (`markdown` | `json`, default `markdown`).
  - Example queries: `author:"Einstein, A." title:relativity`, `black holes year:2020-2023`, `author:^Smith`, `dark energy AND galaxy clusters`.
- `get_paper`: Fetch a paper by `bibcode` with optional `response_format`.
- `get_metrics`: Metrics for `bibcodes` (1-2000) with optional `response_format`; returns h-index, g-index, citation counts, usage stats.

### Citation Network

- `get_citations`: Forward citations for `bibcode`; optional `rows` (1-100, default 20) and `response_format`.
- `get_references`: Backward references for `bibcode`; optional `rows` (1-100, default 20) and `response_format`.

### Export

- `export`: Export `bibcodes` (1-2000) in `format` (`bibtex` | `aastex` | `endnote` | `medlars`). Returns plain text in the chosen format.

### Documentation

- `search_docs`: Search SciX help documentation. Params: `query` (required, natural language), `limit` (1-20, default 5). Returns a ranked list with title, section/subsection, source URL, relevance score, and a focused snippet.

### Libraries

- `get_libraries`: List libraries; optional `type` (`all` | `owner` | `collaborator`, default `all`) and `response_format`.
- `get_library`: Metadata + documents for `library_id`; optional `response_format`.
- `create_library`: Create with `name` (required), optional `description`, `public` (default `false`), `bibcodes`, and `response_format`.
- `delete_library`: Permanently delete by `library_id`; optional `response_format`.
- `edit_library`: Update `name`, `description`, or `public` for `library_id`; optional `response_format`.
- `manage_documents`: Add/remove documents with `library_id`, `bibcodes` (1-2000), `action` (`add` | `remove`), and optional `response_format`.
- `add_documents_by_query`: Add search results to a library with `library_id`, `query`, optional `rows` (1-2000, default 25), and `response_format`.
- `library_operation`: Run set ops on a library with `library_id`, `operation` (`union` | `intersection` | `difference` | `copy` | `empty`), optional `source_library_ids`, `name`/`description` (for copy), and `response_format`.

### Permissions & Sharing

- `get_permissions`: View owners/collaborators for `library_id`; optional `response_format`.
- `update_permissions`: Grant/change a user's access with `library_id`, `email`, `permission` (`owner` | `admin` | `write` | `read`), and optional `response_format`.
- `transfer_library`: Transfer ownership with `library_id`, `email`, and optional `response_format`.

### Annotations

- `get_annotation`: Fetch note content for `library_id` + `bibcode`; optional `response_format`.
- `manage_annotation`: Add/update note with `library_id`, `bibcode`, `content`, and optional `response_format`.
- `delete_annotation`: Remove note for `library_id` + `bibcode`; optional `response_format`.

## Rate Limits

- **5000 requests per day** per API key
- Rate limit info is returned in response headers
- Contact adshelp@cfa.harvard.edu for higher limits

## SciX Search Syntax

The SciX search supports powerful query syntax:

| Syntax                  | Description       | Example                          |
| ----------------------- | ----------------- | -------------------------------- |
| `author:"Last, F."`     | Exact author      | `author:"Huchra, John"`          |
| `author:^Last`          | First author      | `author:^Smith`                  |
| `title:keyword`         | Title search      | `title:exoplanet`                |
| `abstract:keyword`      | Abstract search   | `abstract:"dark matter"`         |
| `year:YYYY-YYYY`        | Year range        | `year:2020-2023`                 |
| `property:refereed`     | Refereed only     | `property:refereed`              |
| `citations(bibcode:X)`  | Papers citing X   | `citations(bibcode:2019ApJ...)`  |
| `references(bibcode:X)` | Papers cited by X | `references(bibcode:2019ApJ...)` |
| `AND`, `OR`, `NOT`      | Boolean operators | `black holes AND galaxy`         |

## Development

### Install & Build

```bash
npm install
npm run build
```

### Local commands

```bash
# Watch mode
npm run dev

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node build/index.js
```

## Testing

The project includes a comprehensive test suite using Vitest.

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

### Test Structure

Tests are organized in the `test/` directory:

```
test/
├── helpers/
│   └── mockFetch.ts        # Fetch mocking utilities
├── client.test.ts          # HTTP client tests
├── search-docs.test.ts     # Documentation search tests
└── tools/
    ├── search.test.ts      # Search tool tests
    ├── paper.test.ts       # Paper details tests
    ├── metrics.test.ts     # Metrics tests
    ├── citations.test.ts   # Citations/references tests
    ├── export.test.ts      # Export tests
    └── library.test.ts     # Library management tests
```

### Test Coverage

The test suite covers:

- **HTTP Client**: GET/POST/PUT/DELETE methods, error handling (401/404/429), timeouts, request formatting
- **Search Tools**: Query parameter encoding, pagination, result limiting, response formatting
- **Paper Tools**: Bibcode validation, field selection, error handling for missing papers
- **Metrics Tools**: Batch bibcode processing, MAX_BIBCODES limits, metric type selection
- **Citation Tools**: Forward/backward citations, sorting, row limits
- **Export Tools**: Multiple export formats (BibTeX, AASTeX, EndNote, etc.), batch processing
- **Library Tools**: All CRUD operations, permissions, annotations, library operations

### API Token for Tests

Tests use mock fetch and don't require a real API token. The test suite sets `ADS_DEV_KEY=test-api-key` automatically.

### Live Integration Tests (Optional)

To run tests against the real ADS API (skipped by default):

1. Set your real API key:
   ```bash
   export SCIX_API_TOKEN=your_real_api_key
   ```

2. Run integration tests (not implemented yet):
   ```bash
   pnpm test:integration
   ```

**Note**: Integration tests count against your daily rate limit (5000 requests/day).

## Project Structure

```
src/
├── index.ts          # Main server entry point
├── client.ts         # SciX API client wrapper
├── types.ts          # TypeScript/Zod type definitions
├── formatters.ts     # Response formatting utilities
├── config.ts         # Configuration constants
└── tools/
    ├── search.ts     # Search tool
    ├── paper.ts      # Paper details tool
    ├── metrics.ts    # Metrics tool
    ├── citations.ts  # Citation network tools
    └── export.ts     # Export tool
```

### Library tools

- `get_libraries` / `get_library`: List and inspect libraries
- `create_library` / `delete_library` / `edit_library`: Manage library metadata
- `manage_documents`: Add/remove bibcodes to a library
- `add_documents_by_query`: Add results from a search query to a library
- `library_operation`: Union/intersection/difference/copy/empty on libraries
- `get_permissions` / `update_permissions` / `transfer_library`: Manage sharing
- `get_annotation` / `manage_annotation` / `delete_annotation`: Handle notes on documents

## Example Usage

### Search for papers

```
Use search with query "supernova 2023" to find recent supernova papers
```

### Get paper details

```
Use get_paper with bibcode "2023ApJ...950..123S"
```

### Calculate metrics

```
Use get_metrics with bibcodes ["2023ApJ...950..123S", "2022MNRAS.517.1234T"]
```

### Export citations

```
Use export with bibcodes ["2023ApJ...950..123S"] and format "bibtex"
```

## Error Handling

The server provides clear error messages:

- **401**: Invalid API key - check `SCIX_API_TOKEN`
- **404**: Resource not found - check bibcode format
- **429**: Rate limit exceeded - wait until reset
- **Timeout**: Request took > 30 seconds

## Resources

- [SciX Homepage](https://scixplorer.org/)
- [SciX API Documentation](https://github.com/adsabs/adsabs-dev-api)
- [SciX Search Syntax](https://adsabs.github.io/help/search/search-syntax)
- [MCP Documentation](https://modelcontextprotocol.io/)

## License

MIT

## Support

For API issues: adshelp@cfa.harvard.edu
For server issues: Open an issue on GitHub
