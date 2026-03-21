export function formatPaperMarkdown(paper: any): string {
  const authors = paper.author || [];
  const authorStr = authors.length > 3
    ? `${authors.slice(0, 3).join(', ')} et al.`
    : authors.join(', ');

  let result = `# ${paper.title?.[0] || 'Untitled'}\n\n`;
  result += `**Authors:** ${authorStr}\n\n`;
  result += `**Bibcode:** ${paper.bibcode}\n\n`;
  result += `**Year:** ${paper.year || 'N/A'}\n\n`;
  result += `**Publication:** ${paper.pub || 'N/A'}\n\n`;

  if (paper.citation_count) {
    result += `**Citations:** ${paper.citation_count}\n\n`;
  }

  if (paper.read_count) {
    result += `**Reads:** ${paper.read_count}\n\n`;
  }

  if (paper.doi?.[0]) {
    result += `**DOI:** https://doi.org/${paper.doi[0]}\n\n`;
  }

  if (paper.arxiv_id) {
    result += `**arXiv:** https://arxiv.org/abs/${paper.arxiv_id}\n\n`;
  }

  if (paper.abstract) {
    result += `## Abstract\n\n${paper.abstract}\n\n`;
  }

  return result;
}

export function formatPapersListMarkdown(papers: any[], total: number): string {
  let result = `# Search Results\n\nFound ${total} total papers, showing ${papers.length}\n\n`;

  papers.forEach((paper, idx) => {
    const firstAuthor = paper.author?.[0] || 'Unknown';
    const title = paper.title?.[0] || 'Untitled';
    const year = paper.year || 'N/A';
    const citations = paper.citation_count || 0;

    result += `${idx + 1}. **${title}**\n`;
    result += `   - ${firstAuthor} (${year})\n`;
    result += `   - Bibcode: \`${paper.bibcode}\`\n`;
    result += `   - Citations: ${citations}\n\n`;
  });

  return result;
}

export function formatMetricsMarkdown(metrics: any): string {
  let result = `# Citation Metrics\n\n`;

  if (metrics.indicators) {
    result += `## Indicators\n\n`;
    result += `- **h-index:** ${metrics.indicators.h || 0}\n`;
    result += `- **g-index:** ${metrics.indicators.g || 0}\n`;
    result += `- **i10-index:** ${metrics.indicators.i10 || 0}\n`;
    result += `- **m-index:** ${metrics.indicators.m?.toFixed(2) || 0}\n`;
    result += `- **tori index:** ${metrics.indicators.tori?.toFixed(2) || 0}\n\n`;
  }

  if (metrics['citation stats']) {
    const stats = metrics['citation stats'];
    result += `## Citation Statistics\n\n`;
    result += `- **Total citations:** ${stats['total number of citations'] || 0}\n`;
    result += `- **Total refereed citations:** ${stats['total number of refereed citations'] || 0}\n`;
    result += `- **Average citations:** ${stats['average number of citations']?.toFixed(1) || 0}\n`;
    result += `- **Median citations:** ${stats['median number of citations'] || 0}\n`;
    result += `- **Self-citations:** ${stats['number of self-citations'] || 0}\n\n`;
  }

  if (metrics['basic stats']) {
    const stats = metrics['basic stats'];
    result += `## Paper Statistics\n\n`;
    result += `- **Total papers:** ${stats['number of papers'] || 0}\n`;
    result += `- **Total reads:** ${stats['total number of reads'] || 0}\n`;
    result += `- **Average reads:** ${stats['average number of reads']?.toFixed(1) || 0}\n\n`;
  }

  return result;
}

export function formatCitationNetworkMarkdown(papers: any[], relationship: string, total: number): string {
  let result = `# ${relationship}\n\nFound ${total} total papers, showing ${papers.length}\n\n`;

  papers.forEach((paper, idx) => {
    const firstAuthor = paper.author?.[0] || 'Unknown';
    const title = paper.title?.[0] || 'Untitled';
    const year = paper.year || 'N/A';
    const citations = paper.citation_count || 0;

    result += `${idx + 1}. **${title}**\n`;
    result += `   - ${firstAuthor} (${year})\n`;
    result += `   - Bibcode: \`${paper.bibcode}\`\n`;
    result += `   - Citations: ${citations}\n\n`;
  });

  return result;
}
