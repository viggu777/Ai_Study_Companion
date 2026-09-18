import { describe, it, expect } from "vitest";
import {
  aiService,
  EMBEDDING_QUERY_TASK,
  formatDocumentForEmbedding,
  formatQueryForEmbedding,
  getActiveEmbeddingInfo,
} from "@/lib/ai/AIService";

describe("gemini-embedding-2 instruction formatting", () => {
  it("formats queries with the retrieval task prefix", () => {
    expect(formatQueryForEmbedding("What is photosynthesis?")).toBe(
      "task: search result | query: What is photosynthesis?"
    );
    // trims surrounding whitespace
    expect(formatQueryForEmbedding("  hello world  ")).toBe("task: search result | query: hello world");
    expect(EMBEDDING_QUERY_TASK).toBe("search result");
  });

  it("formats documents with title + text structure", () => {
    expect(formatDocumentForEmbedding("chunk content", "Biology.pdf")).toBe(
      "title: Biology.pdf | text: chunk content"
    );
  });

  it("defaults document title to none when missing", () => {
    expect(formatDocumentForEmbedding("chunk content")).toBe("title: none | text: chunk content");
    expect(formatDocumentForEmbedding("chunk content", "   ")).toBe("title: none | text: chunk content");
  });

  it("uses an asymmetric pair (query and document formats differ)", () => {
    const q = formatQueryForEmbedding("same text");
    const d = formatDocumentForEmbedding("same text", "none");
    expect(q).not.toBe(d);
    expect(q).toContain("task:");
    expect(d).toContain("title:");
  });
});

describe("gemini-embedding-2 active config", () => {
  it("defaults to gemini-embedding-2 at 768 dims", () => {
    // vitest does not load .env.local, so unset env falls back to defaults.
    // If the runner exports GEMINI_* overrides, the info must still follow them.
    const info = getActiveEmbeddingInfo();
    expect(info.provider).toBe("gemini");
    expect(info.model).toBe(process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2");
    expect(info.dimension).toBe(
      process.env.GEMINI_EMBEDDING_DIM ? parseInt(process.env.GEMINI_EMBEDDING_DIM, 10) : 768
    );
  });

  it("rejects empty embedding input before any network call", async () => {
    await expect(aiService.generateEmbedding({ input: "" })).rejects.toThrow(/non-empty/);
    await expect(aiService.generateEmbedding({ input: ["ok", "   "] })).rejects.toThrow(/non-empty/);
    await expect(aiService.generateEmbedding({ input: [], purpose: "query" })).rejects.toThrow(/non-empty/);
  });
});
