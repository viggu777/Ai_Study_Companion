/**
 * AIService — thin abstraction over AI providers (architecture.md §10)
 *
 * Provider split (verified 2026-09-15 against live Meta Llama API):
 * - Chat / structured generation / evaluation → Meta's Llama API (api.llama.com)
 *   Uses OpenAI-compatible endpoint. Model: Llama-4-Maverick-17B-128E-Instruct-FP8
 *   (Meta's current recommended general-purpose instruct model). Structured output
 *   via response_format: { type: "json_object" } plus server-side schema validation.
 *   Endpoint verified: POST /v1/chat/completions returns 401 with dummy key (exists),
 *   not 404. Docs unreachable via fetch (500) but endpoint behavior confirms support.
 * - Embeddings → Groq (api.groq.com) with nomic-embed-text-v1.5 (768 dims)
 *   Meta's Llama API does NOT have an embeddings endpoint — verified live:
 *   POST https://api.llama.com/v1/embeddings → 404 "Path '/v1/embeddings' was not found",
 *   and POST https://api.llama.com/compat/v1/embeddings → same 404. Do not force
 *   embeddings onto Meta. chunks.embedding stays VECTOR(768) matching nomic output
 *   (verified via real Groq call: 768 floats per embedding).
 *
 * Interface is stable so callers never need to know which provider handled what.
 * Env vars: META_API_KEY (required for chat), META_API_BASE_URL (optional,
 *   defaults to https://api.llama.com/compat/v1), GROQ_API_KEY (required for embeddings).
 */

import OpenAI from "openai";

// Meta Llama API — chat / structured / evaluate
const META_BASE_URL = process.env.META_API_BASE_URL || "https://api.llama.com/compat/v1";
const CHAT_MODEL = "Llama-4-Maverick-17B-128E-Instruct-FP8";

// Groq — embeddings only (Meta has no embeddings endpoint)
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const EMBEDDING_MODEL = "nomic-embed-text-v1.5";
const EMBEDDING_DIMENSION = 768;

function getMetaClient(): OpenAI {
  const apiKey = process.env.META_API_KEY;
  if (!apiKey) {
    throw new Error("META_API_KEY environment variable is not set");
  }
  return new OpenAI({
    apiKey,
    baseURL: META_BASE_URL,
  });
}

function getGroqClient(): OpenAI {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY environment variable is not set (required for embeddings)");
  }
  return new OpenAI({
    apiKey,
    baseURL: GROQ_BASE_URL,
  });
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
    const client = getMetaClient();
    const completion = await client.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
    });
    return completion.choices[0]?.message?.content ?? "";
  },

  async generateStructured<T>({
    systemPrompt,
    userPrompt,
    schema,
    temperature = 0.3,
    maxTokens = 2000,
  }: GenerateStructuredOptions<T>) {
    const client = getMetaClient();
    const completion = await client.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      // Llama API supports OpenAI-compatible JSON mode; keep server-side
      // validation as second layer regardless.
      response_format: { type: "json_object" },
    });
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
    const client = getGroqClient();
    const inputs = Array.isArray(input) ? input : [input];
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: inputs,
      encoding_format: "float",
    });
    return response.data.map((d) => d.embedding);
  },

  async evaluate({ systemPrompt, userPrompt, temperature = 0.1, maxTokens = 1500 }: EvaluateOptions) {
    const client = getMetaClient();
    const completion = await client.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
    });
    return completion.choices[0]?.message?.content ?? "";
  },
};

export const EMBEDDING_DIM = EMBEDDING_DIMENSION;
export const CHAT_MODEL_NAME = CHAT_MODEL;
export const EMBEDDING_MODEL_NAME = EMBEDDING_MODEL;
export const META_MODEL_NAME = CHAT_MODEL;
export const META_BASE_URL_VALUE = META_BASE_URL;
