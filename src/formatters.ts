import type { ArxivPaper, ArxivReadPaperResult } from './clients/arxiv.js';
import type { SciXDocSearchResult } from './clients/scix_docs.js';

// ── SciX formatters ──────────────────────────────────────────────────────────

export function formatScixPaper(p: Record<string, unknown>): string {
  const authors = (p['author'] as string[] | undefined) ?? [];
  const authorStr = authors.length > 3
    ? `${authors.slice(0, 3).join(', ')} et al.`
    : authors.join(', ');

  const title = (p['title'] as string[] | undefined)?.[0] ?? 'Untitled';
  let result = `# ${title}\n\n`;
  result += `**Authors:** ${authorStr || 'N/A'}\n\n`;
  result += `**Bibcode:** \`${p['bibcode'] ?? 'N/A'}\`\n\n`;
  result += `**Year:** ${p['year'] ?? 'N/A'}\n\n`;
  result += `**Publication:** ${p['pub'] ?? 'N/A'}\n\n`;

  if (p['citation_count']) result += `**Citations:** ${p['citation_count']}\n\n`;
  if (p['read_count']) result += `**Reads:** ${p['read_count']}\n\n`;

  const doi = (p['doi'] as string[] | undefined)?.[0];
  if (doi) result += `**DOI:** https://doi.org/${doi}\n\n`;

  if (p['arxiv_id']) result += `**arXiv:** https://arxiv.org/abs/${p['arxiv_id']}\n\n`;
  if (p['bibcode']) result += `**SciX:** https://scixplorer.org/abs/${p['bibcode']}\n\n`;

  if (p['abstract']) result += `## Abstract\n\n${p['abstract']}\n\n`;

  return result;
}

export function formatScixList(
  papers: Record<string, unknown>[],
  total: number,
  heading = 'Search Results'
): string {
  let result = `# ${heading}\n\nFound **${total}** total, showing **${papers.length}**\n\n`;

  papers.forEach((p, idx) => {
    const title = (p['title'] as string[] | undefined)?.[0] ?? 'Untitled';
    const firstAuthor = (p['author'] as string[] | undefined)?.[0] ?? 'Unknown';
    const year = p['year'] ?? 'N/A';
    const citations = p['citation_count'] ?? 0;
    const bibcode = p['bibcode'] ?? '';

    result += `${idx + 1}. **${title}**\n`;
    result += `   - ${firstAuthor} (${year})\n`;
    result += `   - Bibcode: \`${bibcode}\`\n`;
    result += `   - Citations: ${citations}\n\n`;
  });

  return result;
}

// ── arXiv formatters ─────────────────────────────────────────────────────────

export function formatArxivPaper(p: ArxivPaper): string {
  const authorStr = p.authors.length > 3
    ? `${p.authors.slice(0, 3).join(', ')} et al.`
    : p.authors.join(', ');

  const date = p.published.slice(0, 10);

  let result = `# ${p.title}\n\n`;
  result += `**Authors:** ${authorStr || 'N/A'}\n\n`;
  result += `**arXiv ID:** \`${p.id}\`\n\n`;
  result += `**Published:** ${date}\n\n`;
  if (p.updated && p.updated !== p.published) {
    result += `**Updated:** ${p.updated.slice(0, 10)}\n\n`;
  }
  result += `**Categories:** ${p.categories.join(', ')}\n\n`;
  if (p.doi) result += `**DOI:** https://doi.org/${p.doi}\n\n`;
  result += `**Links:** [Abstract](${p.absUrl}) | [PDF](${p.pdfUrl}) | [HTML](${p.htmlUrl})\n\n`;
  result += `## Abstract\n\n${p.abstract}\n\n`;

  return result;
}

export function formatArxivList(papers: ArxivPaper[]): string {
  let result = `# arXiv Search Results\n\nFound **${papers.length}** paper(s)\n\n`;

  papers.forEach((p, idx) => {
    const firstAuthor = p.authors[0] ?? 'Unknown';
    const date = p.published.slice(0, 10);

    result += `${idx + 1}. **${p.title}**\n`;
    result += `   - ${firstAuthor} (${date})\n`;
    result += `   - ID: \`${p.id}\`\n`;
    result += `   - Categories: ${p.categories.slice(0, 3).join(', ')}\n`;
    result += `   - [Abstract](${p.absUrl})\n\n`;
  });

  return result;
}

export function formatArxivReadPaper(result: ArxivReadPaperResult): string {
  if (!result.paper) {
    return 'No paper found.';
  }

  const paper = result.paper;
  const authorStr = paper.authors.length > 3
    ? `${paper.authors.slice(0, 3).join(', ')} et al.`
    : paper.authors.join(', ');

  let output = `# ${paper.title}\n\n`;
  output += `**Authors:** ${authorStr || 'N/A'}\n\n`;
  output += `**arXiv ID:** \`${paper.id}\`\n\n`;
  output += `**Source:** ${result.source === 'tex' ? 'arXiv source archive' : result.source === 'html' ? 'arXiv HTML' : result.source === 'pdf' ? 'arXiv PDF' : 'Abstract fallback'}\n\n`;
  if (result.sourceName) {
    output += `**Source file:** \`${result.sourceName}\`\n\n`;
  }
  output += `**Links:** [Abstract](${paper.absUrl}) | [PDF](${paper.pdfUrl}) | [HTML](${paper.htmlUrl})\n\n`;
  if (paper.doi) {
    output += `**DOI:** https://doi.org/${paper.doi}\n\n`;
  }
  output += `## Extracted text\n\n${result.content.trim()}\n`;

  return output.trim() + '\n';
}

export function formatArxivFullText(p: ArxivPaper, fullText: string): string {
  const authorStr = p.authors.length > 3
    ? `${p.authors.slice(0, 3).join(', ')} et al.`
    : p.authors.join(', ');

  const date = p.published.slice(0, 10);

  let result = `# ${p.title}\n\n`;
  result += `**Authors:** ${authorStr || 'N/A'}\n\n`;
  result += `**arXiv ID:** \`${p.id}\`\n\n`;
  result += `**Published:** ${date}\n\n`;
  result += `**Links:** [Abstract](${p.absUrl}) | [PDF](${p.pdfUrl}) | [HTML](${p.htmlUrl})\n\n`;
  result += `## Abstract\n\n${p.abstract}\n\n`;
  result += `## Full text\n\n${fullText || '_No text could be extracted from the PDF._'}\n\n`;

  return result;
}

export function formatScixDocsResults(results: SciXDocSearchResult[], query: string): string {
  let result = `# SciX Documentation Search\n\nFound **${results.length}** result(s) for **${query}**\n\n`;

  results.forEach((doc, idx) => {
    result += `${idx + 1}. **${doc.title}**\n`;
    result += `   - Section: ${doc.section || 'N/A'}${doc.subsection ? ` / ${doc.subsection}` : ''}\n`;
    result += `   - Source: [${doc.source_file || 'docs'}](${doc.source_url})\n`;
    result += `   - Snippet: ${doc.snippet}\n\n`;
  });

  return result;
}
