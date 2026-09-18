/**
 * AIService — thin abstraction over AI providers (architecture.md §10)
 *
 * Provider split:
 * - Chat / structured generation / evaluation → Mercury (Inception Labs)
 *   OpenAI-compatible endpoint, default https://api.inceptionlabs.ai/v1,
 *   model `mercury-2.5` (verified live: supports json_mode + structured_outputs,
 *   so response_format: { type: "json_object" } + server-side validation holds).
 *   Mercury uses `max_completion_tokens` instead of `max_tokens` — mapped below.
 *   Env: MERCURY_API_KEY (or INCEPTION_API_KEY), MERCURY_API_BASE_URL
 *   (optional), MERCURY_CHAT_MODEL (optional, defaults to mercury-2.5).
 * - Chat fallback (production path) → Meta's Llama API (api.llama.com),
 *   model `Llama-4-Maverick-17B-128E-Instruct-FP8`. Used automatically when
 *   MERCURY_API_KEY is unset. Env: META_API_KEY, META_API_BASE_URL (optional).
 *   Production switch = unset MERCURY_API_KEY + set META_API_KEY. No code change.
 * - Embeddings → Google Gemini Embeddings API (`gemini-embedding-001`,
 *   768 dims via outputDimensionality truncation, Free Tier eligible).
 *   Neither Mercury (verified 404 on POST /v1/embeddings) nor Meta's Llama API
 *   (verified 404) exposes an embeddings endpoint. chunks.embedding is
 *   VECTOR(768) per db/schema/006_embeddings_gemini_768.sql. Never mix vectors
 *   from different models — old bge-small (384d) / nomic (768d) rows must be
 *   purged + re-embedded via Retry (see 006 migration).
 *   Env: GEMINI_API_KEY (required, server-only), GEMINI_EMBEDDING_MODEL
 *   (optional, defaults to gemini-embedding-001), GEMINI_EMBEDDING_DIM
 *   (optional, defaults to 768 — must match chunks.embedding).
 *
 * Interface is stable so callers never need to know which provider handled what.
 */

import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

// Mercury (Inception Labs) — chat / structured / evaluate (testing default)
const MERCURY_BASE_URL = process.env.MERCURY_API_BASE_URL || "https://api.inceptionlabs.ai/v1";
const MERCURY_CHAT_MODEL = process.env.MERCURY_CHAT_MODEL || "mercury-2.5";

// Meta Llama API — chat / structured / evaluate (production fallback)
const META_BASE_URL = process.env.META_API_BASE_URL || "https://api.llama.com/compat/v1";
const META_CHAT_MODEL = "Llama-4-Maverick-17B-128E-Instruct-FP8";

// Embeddings — Google Gemini Embeddings API (single provider for both
// document chunks and query embeddings — same model + same config).
// Default: gemini-embedding-001 with outputDimensionality=768 (Matryoshka
// truncation; 3072 native). 768 keeps storage/vector-search cost low and is
// more than sufficient given the previous 384-dim model worked. Override via
// GEMINI_EMBEDDING_MODEL / GEMINI_EMBEDDING_DIM only together with a matching
// chunks.embedding migration. Never mix dimensions in chunks.embedding.
const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
const GEMINI_EMBEDDING_DIM = (() => {
  const raw = process.env.GEMINI_EMBEDDING_DIM || "768";
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 768;
})();

// Request timeouts — a hung provider must fail fast with an actionable
// message instead of hanging the UI until the platform kills the request.
const CHAT_TIMEOUT_MS = 90_000;

/**
 * Map low-level provider errors (timeouts, connection failures) to
 * user-friendly messages. Pass-through for anything already actionable.
 */
export function friendlyAiErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/timed out|timeout|ETIMEDOUT|APIConnectionTimeout/i.test(msg)) {
    return "AI request timed out — the provider took too long to respond. Please try again.";
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|socket hang up/i.test(msg)) {
    return "Could not reach the AI provider — check your connection and try again.";
  }
  return msg;
}

const EMBEDDING_DIMENSION = GEMINI_EMBEDDING_DIM;

/**
 * Mercury request shaping. Mercury is a reasoning model with two quirks
 * (verified live 2026-09-17):
 * 1. Reasoning tokens consume the output budget. A trivial prompt burned ~280
 *    reasoning tokens before writing content, so a small max_completion_tokens
 *    ends with finish_reason=length and content=null. Always add headroom.
 * 2. Temperature outside [0.5, 1] is rejected/coerced — clamp it.
 * Structured tasks (extraction/grading) use reasoning_effort=low: they are
 * constrained, not deep-reasoning, and low keeps the budget for real output.
 * Free-form tutor text keeps the medium default for quality.
 */
const MERCURY_TOKEN_HEADROOM = 1500;

function mercuryBudget(maxTokens: number): number {
  return Math.max(maxTokens, 2000) + MERCURY_TOKEN_HEADROOM;
}

function mercuryTemp(temperature: number): number {
  return Math.min(1, Math.max(0.5, temperature));
}

function getMercuryApiKey(): string | undefined {
  return process.env.MERCURY_API_KEY || process.env.INCEPTION_API_KEY;
}

function isMercuryActive(): boolean {
  return !!getMercuryApiKey();
}

interface ChatClient {
  client: OpenAI;
  model: string;
  /** Mercury expects max_completion_tokens; Meta/OpenAI-style expects max_tokens */
  useMaxCompletionTokens: boolean;
  label: string;
}

function getChatClient(): ChatClient {
  const mercuryKey = getMercuryApiKey();
  if (mercuryKey) {
    return {
      client: new OpenAI({ apiKey: mercuryKey, baseURL: MERCURY_BASE_URL, timeout: CHAT_TIMEOUT_MS }),
      model: MERCURY_CHAT_MODEL,
      useMaxCompletionTokens: true,
      label: `Mercury/${MERCURY_CHAT_MODEL}`,
    };
  }
  const metaKey = process.env.META_API_KEY;
  if (!metaKey) {
    throw new Error(
      "No chat provider configured: set MERCURY_API_KEY (testing) or META_API_KEY (production)"
    );
  }
  return {
    client: new OpenAI({ apiKey: metaKey, baseURL: META_BASE_URL, timeout: CHAT_TIMEOUT_MS }),
    model: META_CHAT_MODEL,
    useMaxCompletionTokens: false,
    label: `Meta/${META_CHAT_MODEL}`,
  };
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is not set (required for Gemini embeddings). Get a free key at https://aistudio.google.com/apikey and set GEMINI_API_KEY in .env.local — never expose it to client-side code."
    );
  }
  return new GoogleGenAI({ apiKey });
}

export function getActiveEmbeddingInfo(): { provider: string; model: string; dimension: number } {
  return { provider: "gemini", model: GEMINI_EMBEDDING_MODEL, dimension: GEMINI_EMBEDDING_DIM };
}

export interface GenerateTextOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface GenerateStructuredOptions<T> {
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateEmbeddingOptions {
  input: string | string[];
}

export interface EvaluateOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIService {
  generateText(options: GenerateTextOptions): Promise<string>;
  generateStructured<T>(options: GenerateStructuredOptions<T>): Promise<T>;
  generateEmbedding(options: GenerateEmbeddingOptions): Promise<number[][]>;
  evaluate(options: EvaluateOptions): Promise<string>;
}

function validateStructuredOutput<T>(data: unknown, schema: Record<string, unknown>): T {
  const requiredKeys = Object.keys(schema);
  if (typeof data !== "object" || data === null) {
    throw new Error("Structured output is not an object");
  }
  const obj = data as Record<string, unknown>;
  for (const key of requiredKeys) {
    if (!(key in obj)) {
      throw new Error(`Missing required field in structured output: ${key}`);
    }
  }
  return data as T;
}

export const aiService: AIService = {
  async generateText({ systemPrompt, userPrompt, temperature = 0.7, maxTokens = 2000 }: GenerateTextOptions) {
    const { client, model, useMaxCompletionTokens } = getChatClient();
    let completion;
    try {
      completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        // Mercury: medium (default) reasoning effort, clamped temp, budget headroom.
        temperature: useMaxCompletionTokens ? mercuryTemp(temperature) : temperature,
        ...(useMaxCompletionTokens ? { max_completion_tokens: mercuryBudget(maxTokens) } : { max_tokens: maxTokens }),
      });
    } catch (e) {
      throw new Error(friendlyAiErrorMessage(e));
    }
    const content = completion.choices[0]?.message?.content ?? "";
    if (!content) {
      throw new Error(
        `Empty response from chat provider (finish_reason=${completion.choices[0]?.finish_reason ?? "unknown"} — likely output budget cut off by reasoning tokens)`
      );
    }
    return content;
  },

  async generateStructured<T>({
    systemPrompt,
    userPrompt,
    schema,
    temperature = 0.3,
    maxTokens = 2000,
  }: GenerateStructuredOptions<T>) {
    const { client, model, useMaxCompletionTokens } = getChatClient();
    let completion;
    try {
      completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: useMaxCompletionTokens ? mercuryTemp(temperature) : temperature,
        ...(useMaxCompletionTokens
          ? { max_completion_tokens: mercuryBudget(maxTokens), reasoning_effort: "low" as const }
          : { max_tokens: maxTokens }),
        // JSON mode (Mercury + Llama API both support it); keep server-side
        // validation as second layer regardless.
        response_format: { type: "json_object" },
      });
    } catch (e) {
      throw new Error(friendlyAiErrorMessage(e));
    }
    const content = completion.choices[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Failed to parse JSON from structured output");
    }
    return validateStructuredOutput<T>(parsed, schema);
  },

  async generateEmbedding({ input }: GenerateEmbeddingOptions) {
    // Single embedding path for BOTH document chunks and user queries —
    // same Gemini model + same outputDimensionality, so doc and query vectors
    // are always comparable. Do not introduce separate taskType configs here.
    const info = getActiveEmbeddingInfo();
    const model = info.model;
    const inputs = Array.isArray(input) ? input : [input];
    if (inputs.length === 0 || inputs.some((t) => typeof t !== "string" || t.trim().length === 0)) {
      throw new Error("generateEmbedding: input must be a non-empty string or list of non-empty strings");
    }
    let client: GoogleGenAI;
    try {
      client = getGeminiClient();
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    let response;
    try {
      response = await client.models.embedContent({
        model,
        contents: inputs,
        config: { outputDimensionality: info.dimension },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/429|RESOURCE_EXHAUSTED|rate limit|quota/i.test(msg)) {
        throw new Error(
          `Gemini embedding rate limit hit (${model}). Free Tier is ~100 req/min — back off and retry; batch sizes of 20 are already used. Original: ${msg}`
        );
      }
      if (/API_KEY|API key|APIKEY_INVALID|401|403/i.test(msg)) {
        throw new Error(
          `Gemini embedding auth failed — check GEMINI_API_KEY (https://aistudio.google.com/apikey). Original: ${msg}`
        );
      }
      throw new Error(friendlyAiErrorMessage(e));
    }
    const vectors = (response.embeddings ?? []).map((emb) => emb.values ?? []);
    if (vectors.length !== inputs.length || vectors.some((v) => !Array.isArray(v) || v.length === 0)) {
      throw new Error(
        `Invalid embedding response from Gemini (${model}): expected ${inputs.length} vectors, got ${vectors.length}.`
      );
    }
    // Guard against model/DB dimension drift — a wrong-size vector would fail
    // deep in pgvector with a cryptic error. Fail here with an actionable one.
    if (vectors[0]?.length !== info.dimension) {
      throw new Error(
        `Embedding dimension mismatch: got ${vectors[0]?.length}, expected ${info.dimension} (${info.model}). ` +
          `If you changed the embedding model, migrate chunks.embedding to match — never mix dimensions.`
      );
    }
    return vectors;
  },

  async evaluate({ systemPrompt, userPrompt, temperature = 0.1, maxTokens = 1500 }: EvaluateOptions) {
    const { client, model, useMaxCompletionTokens } = getChatClient();
    let completion;
    try {
      completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: useMaxCompletionTokens ? mercuryTemp(temperature) : temperature,
        ...(useMaxCompletionTokens
          ? { max_completion_tokens: mercuryBudget(maxTokens), reasoning_effort: "low" as const }
          : { max_tokens: maxTokens }),
      });
    } catch (e) {
      throw new Error(friendlyAiErrorMessage(e));
    }
    return completion.choices[0]?.message?.content ?? "";
  },
};

export const EMBEDDING_DIM = EMBEDDING_DIMENSION;
export const CHAT_MODEL_NAME = isMercuryActive() ? MERCURY_CHAT_MODEL : META_CHAT_MODEL;
export const EMBEDDING_MODEL_NAME = getActiveEmbeddingInfo().model;
export const META_MODEL_NAME = META_CHAT_MODEL;
export const META_BASE_URL_VALUE = META_BASE_URL;
export const MERCURY_MODEL_NAME = MERCURY_CHAT_MODEL;
export const MERCURY_BASE_URL_VALUE = MERCURY_BASE_URL;
export const ACTIVE_CHAT_PROVIDER = isMercuryActive() ? "mercury" : "meta";
export const ACTIVE_EMBEDDING_PROVIDER = getActiveEmbeddingInfo().provider;
