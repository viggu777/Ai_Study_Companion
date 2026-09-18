/**
 * R33 — request body schemas + per-user quota constants.
 * Lightweight zod-equivalent validators (no new dependency) so every API
 * body fails closed with 400 on shape failure instead of manual trim/caps.
 * Pure — unit-tested in tests/unit/validation-schemas.test.ts.
 */

export const SPACE_NAME_MAX = 100;
export const DESCRIPTION_MAX = 1000;
export const LEARNING_GOAL_MAX = 2000;
export const QUIZ_COUNT_MIN = 1;
export const QUIZ_COUNT_MAX = 10;
export const QUIZ_RESPONSE_MAX = 10000;
export const QUESTION_ID_MAX = 200;

export const MAX_MATERIALS_PER_USER = 100;
export const MAX_STORAGE_BYTES_PER_USER = 500 * 1024 * 1024; // 500 MB

export interface SchemaResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function asTrimmedString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

export function parseSpaceBody(body: unknown): SchemaResult<{ name: string; description?: string }> {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid JSON body" };
  const b = body as Record<string, unknown>;
  const name = asTrimmedString(b.name, SPACE_NAME_MAX);
  if (!name) return { ok: false, error: `Name is required (1-${SPACE_NAME_MAX} chars)` };
  if (b.description !== undefined) {
    if (typeof b.description !== "string") return { ok: false, error: "Description must be a string" };
    const d = b.description.trim();
    if (d.length > DESCRIPTION_MAX) return { ok: false, error: `Description too long (max ${DESCRIPTION_MAX} chars)` };
    if (d.length === 0) return { ok: true, data: { name } };
    return { ok: true, data: { name, description: d } };
  }
  return { ok: true, data: { name } };
}

export function parseProjectBody(body: unknown): SchemaResult<{ name: string; description?: string; learning_goal?: string }> {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid JSON body" };
  const b = body as Record<string, unknown>;
  const name = asTrimmedString(b.name, SPACE_NAME_MAX);
  if (!name) return { ok: false, error: `Name is required (1-${SPACE_NAME_MAX} chars)` };
  const out: { name: string; description?: string; learning_goal?: string } = { name };
  if (b.description !== undefined) {
    if (typeof b.description !== "string") return { ok: false, error: "Description must be a string" };
    const d = b.description.trim();
    if (d.length > DESCRIPTION_MAX) return { ok: false, error: `Description too long (max ${DESCRIPTION_MAX} chars)` };
    if (d.length > 0) out.description = d;
  }
  if (b.learning_goal !== undefined) {
    if (typeof b.learning_goal !== "string") return { ok: false, error: "learning_goal must be a string" };
    const g = b.learning_goal.trim();
    if (g.length > LEARNING_GOAL_MAX) return { ok: false, error: `learning_goal too long (max ${LEARNING_GOAL_MAX} chars)` };
    if (g.length > 0) out.learning_goal = g;
  }
  return { ok: true, data: out };
}

export function parseQuizGenerateBody(body: unknown): SchemaResult<{ count?: number; conceptIds?: string[]; materialIds?: string[] }> {
  if (typeof body !== "object" || body === null) return { ok: true, data: {} };
  const b = body as Record<string, unknown>;
  let count: number | undefined;
  if (b.count !== undefined) {
    if (typeof b.count !== "number" || !Number.isInteger(b.count)) {
      return { ok: false, error: "count must be an integer" };
    }
    if (b.count < QUIZ_COUNT_MIN || b.count > QUIZ_COUNT_MAX) {
      return { ok: false, error: `count must be ${QUIZ_COUNT_MIN}-${QUIZ_COUNT_MAX}` };
    }
    count = b.count;
  }
  const parseIdList = (v: unknown, max = 200): string[] | undefined | null => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) return null;
    if (v.length === 0) return null;
    if (v.length > max) return null;
    const seen = new Set<string>();
    for (const item of v) {
      if (typeof item !== "string") return null;
      const t = item.trim();
      if (t.length === 0 || t.length > QUESTION_ID_MAX) return null;
      seen.add(t);
    }
    if (seen.size === 0) return null;
    return [...seen];
  };
  const conceptIds = parseIdList(b.conceptIds ?? b.concept_ids);
  if (conceptIds === null) return { ok: false, error: "conceptIds must be a non-empty array of id strings (max 200)" };
  const materialIds = parseIdList(b.materialIds ?? b.material_ids);
  if (materialIds === null) return { ok: false, error: "materialIds must be a non-empty array of id strings (max 200)" };
  return { ok: true, data: { count, conceptIds, materialIds } };
}

export function parseQuizSubmitBody(body: unknown): SchemaResult<{ questionId: string; response: string }> {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid JSON body" };
  const b = body as Record<string, unknown>;
  const qRaw = b.questionId ?? b.question_id;
  if (typeof qRaw !== "string" || qRaw.trim().length === 0) {
    return { ok: false, error: "questionId is required" };
  }
  if (qRaw.trim().length > QUESTION_ID_MAX) {
    return { ok: false, error: "questionId too long" };
  }
  const rRaw = b.response ?? b.answer;
  if (typeof rRaw !== "string" || rRaw.trim().length === 0) {
    return { ok: false, error: "response is required" };
  }
  if (rRaw.trim().length > QUIZ_RESPONSE_MAX) {
    return { ok: false, error: `response too long (max ${QUIZ_RESPONSE_MAX} chars)` };
  }
  return { ok: true, data: { questionId: qRaw.trim(), response: String(rRaw) } };
}

const VALID_REC_STATUSES = ["COMPLETED", "DISMISSED", "ACTIVE"] as const;
export type RecommendationStatus = (typeof VALID_REC_STATUSES)[number];

export function parseRecommendationStatusBody(body: unknown): SchemaResult<{ status: RecommendationStatus }> {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid JSON body" };
  const b = body as Record<string, unknown>;
  if (!VALID_REC_STATUSES.includes(b.status as RecommendationStatus)) {
    return { ok: false, error: "Invalid status" };
  }
  return { ok: true, data: { status: b.status as RecommendationStatus } };
}
