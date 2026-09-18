import { describe, it, expect } from "vitest";
import { estimateCost } from "@/lib/ai/AIService";
import {
  buildEmbeddingCacheKey,
  getCachedQueryEmbedding,
  setCachedQueryEmbedding,
  clearEmbeddingCache,
} from "@/lib/rag/retrieve";

describe("R28 estimateCost", () => {
  it("computes non-zero cost for chat usage", () => {
    const c = estimateCost("mercury-2.5", { inputTokens: 1000, outputTokens: 500 });
    expect(c).toBeGreaterThan(0);
  });

  it("falls back for unknown models", () => {
    const c = estimateCost("unknown-model", { inputTokens: 1000, outputTokens: 1000 });
    expect(c).toBeGreaterThan(0);
  });

  it("zero usage costs zero", () => {
    expect(estimateCost("mercury-2.5", { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});

describe("R35 embedding cache", () => {
  it("misses then hits after set", () => {
    clearEmbeddingCache();
    expect(getCachedQueryEmbedding("What is photosynthesis?")).toBeNull();
    setCachedQueryEmbedding("What is photosynthesis?", [0.1, 0.2, 0.3]);
    expect(getCachedQueryEmbedding("What is photosynthesis?")).toEqual([0.1, 0.2, 0.3]);
  });

  it("normalizes whitespace/case", () => {
    clearEmbeddingCache();
    setCachedQueryEmbedding("  Hello   World ", [1]);
    expect(getCachedQueryEmbedding("hello world")).toEqual([1]);
  });

  it("key includes model/dimension", () => {
    const k = buildEmbeddingCacheKey("test");
    expect(k).toContain(":");
  });
});
