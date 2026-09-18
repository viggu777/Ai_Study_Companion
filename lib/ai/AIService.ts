/**
 * AIService — thin abstraction over AI providers (architecture.md §10)
 *
 * Provider split (testing default: Mercury for chat, Groq for embeddings):
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
 * - Embeddings → local FastEmbed service by default: BAAI/bge-small-en-v1.5
 *   (384 dims, free/open-source, Docker in embeddings/). Neither Mercury
 *   (verified 404 on POST /v1/embeddings) nor Meta's Llama API (verified 404)
 *   exposes an embeddings endpoint. chunks.embedding is VECTOR(384) per
 *   db/schema/004_embeddings_384.sql. Explicit fallback: EMBEDDING_PROVIDER=groq
 *   (nomic-embed-text-v1.5, 768 dims — requires re-migrating the column back).
 *   Env: EMBEDDING_PROVIDER (local|groq, default local), EMBEDDING_API_BASE_URL
 *   (default http://localhost:8000/v1), EMBEDDING_MODEL (default
 *   BAAI/bge-small-en-v1.5), EMBEDDING_API_KEY (optional), GROQ_API_KEY
 *   (only for the groq fallback).
 *
 * Interface is stable so callers never need to know which provider handled what.
 */

import OpenAI from "openai";

// Mercury (Inception Labs) — chat / structured / evaluate (testing default)
const MERCURY_BASE_URL = process.env.MERCURY_API_BASE_URL || "https://api.inceptionlabs.ai/v1";
const MERCURY_CHAT_MODEL = process.env.MERCURY_CHAT_MODEL || "mercury-2.5";

// Meta Llama API — chat / structured / evaluate (production fallback)
const META_BASE_URL = process.env.META_API_BASE_URL || "https://api.llama.com/compat/v1";
const META_CHAT_MODEL = "Llama-4-Maverick-17B-128E-Instruct-FP8";

// Embeddings — local FastEmbed service by default (BAAI/bge-small-en-v1.5,
// 384 dims, see embeddings/ + db/schema/004_embeddings_384.sql). Groq kept as
// an explicit fallback (EMBEDDING_PROVIDER=groq) — note Groq nomic is 768 dims
// and is INCOMPATIBLE with the 384-dim column; switching providers requires
// migrating the column back. Never mix dimensions in chunks.embedding.
const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || "local").toLowerCase();
const LOCAL_EMBED_BASE_URL = process.env.EMBEDDING_API_BASE_URL || "http://localhost:8000/v1";
const LOCAL_EMBED_MODEL = process.env.EMBEDDING_MODEL || "BAAI/bge-small-en-v1.5";
const LOCAL_EMBED_DIM = 384;
const LOCAL_EMBED_API_KEY = process.env.EMBEDDING_API_KEY || "local";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GROQ_EMBEDDING_MODEL = "nomic-embed-text-v1.5";
const GROQ_EMBEDDING_DIM = 768;

// Request timeouts — a hung provider must fail fast with an actionable
// message instead of hanging the UI until the platform kills the request.
const CHAT_TIMEOUT_MS = 90_000;
const EMBEDDING_TIMEOUT_MS = 60_000;

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

const EMBEDDING_DIMENSION = EMBEDDING_PROVIDER === "groq" ? GROQ_EMBEDDING_DIM : LOCAL_EMBED_DIM;

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

function getGroqClient(): OpenAI {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY environment variable is not set (required for EMBEDDING_PROVIDER=groq)");
  }
  return new OpenAI({
    apiKey,
    baseURL: GROQ_BASE_URL,
    timeout: EMBEDDING_TIMEOUT_MS,
  });
}

function getLocalEmbedClient(): OpenAI {
  return new OpenAI({ apiKey: LOCAL_EMBED_API_KEY, baseURL: LOCAL_EMBED_BASE_URL, timeout: EMBEDDING_TIMEOUT_MS });
}

export function getActiveEmbeddingInfo(): { provider: string; model: string; dimension: number } {
  if (EMBEDDING_PROVIDER === "groq") {
    return { provider: "groq", model: GROQ_EMBEDDING_MODEL, dimension: GROQ_EMBEDDING_DIM };
  }
  return { provider: "local", model: LOCAL_EMBED_MODEL, dimension: LOCAL_EMBED_DIM };
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
    const info = getActiveEmbeddingInfo();
    let client: OpenAI;
    let model: string;
    if (info.provider === "groq") {
      client = getGroqClient();
      model = GROQ_EMBEDDING_MODEL;
    } else {
      client = getLocalEmbedClient();
      model = LOCAL_EMBED_MODEL;
    }
    const inputs = Array.isArray(input) ? input : [input];
    let response;
    try {
      response = await client.embeddings.create({
        model,
        input: inputs,
        encoding_format: "float",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (info.provider !== "groq" && (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("Connect"))) {
        throw new Error(
          `Local embeddings service unreachable at ${LOCAL_EMBED_BASE_URL} — start it with: cd embeddings && docker compose up -d --build. Original: ${msg}`
        );
      }
      throw new Error(friendlyAiErrorMessage(e));
    }
    const vectors = response.data.map((d) => d.embedding);
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
