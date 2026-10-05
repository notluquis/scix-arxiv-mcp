# Changelog

## [2.0.0] - Unreleased

Rewrite as a local stdio server for MCP protocol 2026-07-28 only. Requires Claude Code >= 2.1.285 and Node >= 24.

### Breaking

- HTTP/Hono transport and the legacy `@modelcontextprotocol/sdk` are gone; the server runs only over stdio on `@modelcontextprotocol/server` 2.x. A 2025-era client is rejected with JSON-RPC error -32022.
- Tool catalog reorganised (39 tools) with structured outputs (`outputSchema` + `structuredContent`).

### Added

- Section-level paper reading (outline, section, search) from arXiv HTML with MathML to TeX and an ar5iv fallback, with progress notifications.
- LaTeX source tools with bounded e-print extraction and `\input` flattening.
- SciX/ADS: author papers and metrics, author affiliations, SIMBAD/NED object resolution, citation helper, reference resolver, and a `collection` filter on search.
- Full SciX library management (edit, delete, set operations, add by query, permissions, transfer) and `health_check`; destructive actions ask for confirmation through `input_required`.
- Persistent arXiv topic alerts with ascending-watermark draining.
- Six prompts with argument completions, and server instructions.
- Shared arXiv/Semantic Scholar rate limiting, `Retry-After`-aware retries and an XDG disk cache.
- Identifier safety (library ids, bibcodes in URL paths, escaped Solr identifiers) and an untrusted-content banner on fetched paper text.
- In-process 2026-07-28 test harness, an approval-gated contract snapshot (`test/contract.json`) and a stdio smoke test (`pnpm smoke`).
- Claude Code plugin and marketplace (`.claude-plugin/`, token as sensitive `userConfig`), `scix-arxiv-mcp` bin, MIT `LICENSE` and `NOTICE` for upstream attributions.
- CI: hardened tests on Node 24 and 26, zizmor, Dependabot, a daily SDK canary, and a release workflow that moves the `stable` tag.

### Changed

- Dependencies moved to latest (TypeScript 7, Vitest 5, Vite 8, Zod 4); pnpm 12.
- arXiv queries: plain words are ANDed and the user query is parenthesized.
