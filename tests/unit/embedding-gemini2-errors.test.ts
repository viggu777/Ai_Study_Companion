import { describe, it, expect, vi, beforeEach } from "vitest";

// Error-path coverage for Gemini Embedding 2 (no network — @google/genai is mocked).
// Covers the task's required cases without spending quota:
// - invalid embedding response (count mismatch / empty)
// - wrong vector dimension (model/DB drift guard)
// - rate-limit failure mapping (429 → actionable message)
// - timeout / network failure mapping (friendly message)
// - auth failure mapping (API-key message)
// Success-path batch shape is also pinned (one vector per input).

const mockEmbedContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { embedContent: mockEmbedContent };
    constructor(_opts?: unknown) {}
  },
}));

import { aiService, getActiveEmbeddingInfo } from "@/lib/ai/AIService";

const DIM = getActiveEmbeddingInfo().dimension;

function vec(n: number, fill = 0.1): number[] {
  return Array.from({ length: n }, (_, i) => fill + i * 0.0001);
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  mockEmbedContent.mockReset();
});

describe("gemini-embedding-2 error handling (mocked, no quota)", () => {
  it("uses gemini-embedding-2 at 768 dims", () => {
    const info = getActiveEmbeddingInfo();
    expect(info.provider).toBe("gemini");
    expect(info.model).toBe("gemini-embedding-2");
    expect(info.dimension).toBe(768);
  });

  it("returns one vector per input on success (batch shape)", async () => {
    mockEmbedContent.mockResolvedValue({
      embeddings: [{ values: vec(DIM) }, { values: vec(DIM, 0.2) }],
    });
    const out = await aiService.generateEmbedding({ input: ["a", "b"] });
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(DIM);
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
    // Per-input Content objects (not a bare string[]) so the batch
    // does not collapse to a single vector.
    const args = mockEmbedContent.mock.calls[0]?.[0] as {
      contents: Array<{ parts: Array<{ text: string }> }>;
    };
    expect(args.contents).toHaveLength(2);
  });

  it("rejects an invalid response (count mismatch)", async () => {
    mockEmbedContent.mockResolvedValue({ embeddings: [] });
    await expect(aiService.generateEmbedding({ input: "hello" })).rejects.toThrow(
      /Invalid embedding response/
    );
  });

  it("rejects a wrong-dimension vector before pgvector sees it", async () => {
    mockEmbedContent.mockResolvedValue({ embeddings: [{ values: vec(4) }] });
    await expect(aiService.generateEmbedding({ input: "hello" })).rejects.toThrow(
      /dimension mismatch/
    );
  });

  it("maps rate-limit failures to an actionable message", async () => {
    mockEmbedContent.mockRejectedValue(
      new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"quota"}}')
    );
    await expect(aiService.generateEmbedding({ input: "hello" })).rejects.toThrow(
      /rate limit/i
    );
  });

  it("maps timeouts to a friendly message", async () => {
    mockEmbedContent.mockRejectedValue(new Error("fetch failed: socket hang up"));
    await expect(aiService.generateEmbedding({ input: "hello" })).rejects.toThrow(
      /Could not reach the AI provider/
    );
  });

  it("maps auth failures to an API-key message (never logs the key)", async () => {
    mockEmbedContent.mockRejectedValue(new Error("API_KEY_INVALID 401"));
    const err = await aiService
      .generateEmbedding({ input: "hello" })
      .catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    expect(err.message).toMatch(/GEMINI_API_KEY/);
    expect(err.message).not.toContain("test-key");
  });

  it("missing API key fails before any network call", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(aiService.generateEmbedding({ input: "hello" })).rejects.toThrow(
      /GEMINI_API_KEY/
    );
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });
});
