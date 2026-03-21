import { describe, it, expect, beforeAll } from "vitest";
import {
  searchDocs,
  getDocById,
  searchByCategory,
  getStats,
} from "../src/search-docs.js";

const MAX_SNIPPET_LENGTH = 260;

describe("searchDocs", () => {
  beforeAll(async () => {
    await getStats();
  });

  it("should return results for author search query", async () => {
    const results = await searchDocs("author search", 5);

    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);

    const firstResult = results[0];
    expect(firstResult).toHaveProperty("id");
    expect(firstResult).toHaveProperty("title");
    expect(firstResult).toHaveProperty("snippet");
    expect(firstResult).toHaveProperty("score");
  });

  it("should return results for export bibtex query", async () => {
    const results = await searchDocs("export bibtex", 5);

    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBeGreaterThan(0);

    const hasRelevantResult = results.some(
      (r) =>
        r.snippet.toLowerCase().includes("export") ||
        r.snippet.toLowerCase().includes("bibtex")
    );
    expect(hasRelevantResult).toBe(true);
  });

  it("should return results for library create query", async () => {
    const results = await searchDocs("library create", 5);

    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBeGreaterThan(0);

    const hasRelevantResult = results.some(
      (r) =>
        r.snippet.toLowerCase().includes("library") ||
        r.snippet.toLowerCase().includes("create")
    );
    expect(hasRelevantResult).toBe(true);
  });

  it("should limit results to specified number", async () => {
    const results = await searchDocs("search", 3);

    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("should return empty array for empty query", async () => {
    const results = await searchDocs("", 10);

    expect(results).toEqual([]);
  });

  it("should return empty array for whitespace query", async () => {
    const results = await searchDocs("   ", 10);

    expect(results).toEqual([]);
  });

  it("should handle fuzzy matching for typos", async () => {
    const results = await searchDocs("authr serch", 5);

    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBeGreaterThan(0);
  });

  it("should include all required fields in results", async () => {
    const results = await searchDocs("bibcode", 1);

    expect(results.length).toBeGreaterThan(0);

    const result = results[0];
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("section");
    expect(result).toHaveProperty("subsection");
    expect(result).toHaveProperty("source_file");
    expect(result).toHaveProperty("source_url");
    expect(result).toHaveProperty("doc_type");
    expect(result).toHaveProperty("category");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("snippet");

    expect(typeof result.id).toBe("string");
    expect(typeof result.score).toBe("number");
    expect(result.score).toBeGreaterThan(0);
  });
});

describe("getDocById", () => {
  it("should return document by id", async () => {
    const results = await searchDocs("bibcode", 1);
    expect(results.length).toBeGreaterThan(0);

    const doc = await getDocById(results[0].id);

    expect(doc).toBeTruthy();
    expect(doc.id).toBe(results[0].id);
    expect(doc).toHaveProperty("content");
    expect(doc).toHaveProperty("char_count");
  });

  it("should return null for non-existent id", async () => {
    const doc = await getDocById("non_existent_id_12345");

    expect(doc).toBeNull();
  });

  it("should return full content for document", async () => {
    const results = await searchDocs("search", 1);
    expect(results.length).toBeGreaterThan(0);

    const doc = await getDocById(results[0].id);

    expect(doc).toBeTruthy();
    expect(doc!.content).toBeTruthy();
    expect(doc!.content.length).toBeGreaterThan(0);
    expect(doc!.char_count).toBe(doc!.content.length);
  });
});

describe("searchByCategory", () => {
  it("should return only docs from specified category", async () => {
    const results = await searchByCategory("search_docs", "syntax", 10);

    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBeGreaterThan(0);

    const allMatchCategory = results.every((r) => r.category === "search_docs");
    expect(allMatchCategory).toBe(true);
  });

  it("should return docs without query", async () => {
    const results = await searchByCategory("faq", "", 5);

    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBeGreaterThan(0);

    const allMatchCategory = results.every((r) => r.category === "faq");
    expect(allMatchCategory).toBe(true);
  });

  it("should respect limit parameter", async () => {
    const results = await searchByCategory("getting_started", "", 3);

    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("should include snippet in results", async () => {
    const results = await searchByCategory("library_docs", "library", 5);

    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBeGreaterThan(0);

    const allHaveSnippets = results.every(
      (r) => typeof r.snippet === "string" && r.snippet.length > 0
    );
    expect(allHaveSnippets).toBe(true);
  });
});

describe("getStats", () => {
  it("should return statistics about indexed docs", async () => {
    const stats = await getStats();

    expect(stats).toHaveProperty("totalDocs");
    expect(stats).toHaveProperty("byCategory");
    expect(stats).toHaveProperty("byDocType");
    expect(stats).toHaveProperty("avgContentLength");

    expect(stats.totalDocs).toBeGreaterThan(0);
    expect(typeof stats.avgContentLength).toBe("number");
    expect(stats.avgContentLength).toBeGreaterThan(0);
  });

  it("should have multiple categories", async () => {
    const stats = await getStats();

    expect(Object.keys(stats.byCategory).length).toBeGreaterThan(3);

    const categories = Object.keys(stats.byCategory);
    expect(categories).toContain("search_docs");
    expect(categories).toContain("faq");
  });

  it("should have scix_help doc type", async () => {
    const stats = await getStats();

    expect(stats.byDocType).toHaveProperty("scix_help");
    expect(stats.byDocType.scix_help).toBeGreaterThan(0);
  });
});

describe("snippet generation", () => {
  it("should generate snippets centered on search terms", async () => {
    const results = await searchDocs("citation_count", 5);

    expect(results.length).toBeGreaterThan(0);

    const hasRelevantSnippet = results.some((r) =>
      r.snippet.toLowerCase().includes("citation")
    );
    expect(hasRelevantSnippet).toBe(true);
  });

  it("should truncate long content with ellipsis", async () => {
    const results = await searchDocs("library", 10);

    const longSnippets = results.filter(
      (r) =>
        r.snippet.length >= MAX_SNIPPET_LENGTH &&
        (r.snippet.startsWith("...") || r.snippet.endsWith("..."))
    );
    expect(longSnippets.length).toBeGreaterThan(0);
  });

  it("should keep snippets within expected length bounds", async () => {
    const results = await searchDocs("bibcode", 10);

    const allWithinBounds = results.every(
      (r) => r.snippet.length <= MAX_SNIPPET_LENGTH + 6
    );
    expect(allWithinBounds).toBe(true);
  });
});

describe("ranking and scoring", () => {
  it("should return results in descending score order", async () => {
    const results = await searchDocs("search bibcode author", 10);

    expect(results.length).toBeGreaterThan(1);

    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it("should boost title matches higher than content matches", async () => {
    const results = await searchDocs("syntax", 10);

    expect(results.length).toBeGreaterThan(0);

    const titleMatches = results.filter((r) =>
      r.title.toLowerCase().includes("syntax")
    );
    const nonTitleMatches = results.filter(
      (r) => !r.title.toLowerCase().includes("syntax")
    );

    if (titleMatches.length > 0 && nonTitleMatches.length > 0) {
      expect(titleMatches[0].score).toBeGreaterThan(
        nonTitleMatches[nonTitleMatches.length - 1].score
      );
    }
  });
});
