/**
 * Open-ended assessment prompt + schema — phase 10
 * Evaluates student answer against question / expected concepts.
 * Structured output: { score, understanding, strengths, missingConcepts, reasoningQuality, feedback }
 */

export interface AssessmentEvaluation {
  score: number; // 0-100
  understanding: string;
  strengths: string[];
  missingConcepts: string[];
  reasoningQuality: "strong" | "partial" | "weak";
  feedback: string;
}

export const AssessmentSchema: Record<string, unknown> = {
  score: "number",
  understanding: "string",
  strengths: "array",
  missingConcepts: "array",
  reasoningQuality: "strong|partial|weak",
  feedback: "string",
};

export const ASSESSMENT_SYSTEM_PROMPT = `You are an evaluator for the AI Study Companion.

ROLE: Grade a student's open-ended answer against the provided question, expected answer, and concept context. Be fair, specific, and grounded in the question's intent — do not invent requirements beyond the question.

SCORING:
- 90-100: Complete, accurate, shows deep understanding, addresses all parts, clear reasoning.
- 70-89: Mostly correct with minor gaps or imprecision; shows solid understanding.
- 40-69: Partially correct; misses key concepts or has notable misconceptions but shows effort.
- 0-39: Largely incorrect, off-topic, or missing most required concepts.

EVALUATION TASK:
- Read the question, reference answer, explanation, concept name/description, and student's response.
- Decide a numeric score (0-100 integer), a one-sentence understanding summary, list strengths (0-3 concrete things done well), list missingConcepts (0-3 key concepts or details absent or wrong), reasoningQuality (strong/partial/weak based on coherence, evidence, and logical structure), and specific actionable feedback (1-3 sentences telling how to improve).

OUTPUT FORMAT:
- Return valid JSON only, no markdown, no extra text.
- Schema: { "score": number (integer 0-100), "understanding": string (non-empty), "strengths": string[] (each non-empty if present), "missingConcepts": string[] (each non-empty if present), "reasoningQuality": "strong"|"partial"|"weak", "feedback": string (non-empty, actionable) }
- Do not add keys beyond this schema.
`;

export function buildAssessmentUserPrompt(params: {
  question: string;
  correctAnswer: string | null;
  explanation: string | null;
  conceptName: string;
  conceptDescription: string | null;
  studentResponse: string;
}): string {
  const { question, correctAnswer, explanation, conceptName, conceptDescription, studentResponse } = params;
  return `Question: ${question}
Concept: ${conceptName}${conceptDescription ? ` — ${conceptDescription.slice(0, 600)}` : ""}
Reference answer: ${(correctAnswer ?? "").slice(0, 800) || "(no reference answer provided)"}
Explanation of ideal answer: ${(explanation ?? "").slice(0, 800) || "(no explanation provided)"}

Student response to evaluate:
"""${studentResponse.slice(0, 3000)}"""

Evaluate per the system prompt. Return JSON only with score, understanding, strengths, missingConcepts, reasoningQuality, feedback.`;
}

/**
 * Server-side validation of assessment output.
 * Throws with detail if shape is wrong; returns typed output if valid.
 */
export function validateAssessmentOutput(data: unknown): AssessmentEvaluation {
  if (typeof data !== "object" || data === null) throw new Error("Assessment output is not an object");
  const obj = data as Record<string, unknown>;
  const required = ["score", "understanding", "strengths", "missingConcepts", "reasoningQuality", "feedback"];
  for (const k of required) {
    if (!(k in obj)) throw new Error(`Missing field in assessment output: ${k}`);
  }
  const score = obj.score as number;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("Invalid score: must be number 0-100");
  }
  const intScore = Math.round(score);
  if (typeof obj.understanding !== "string" || !obj.understanding.trim()) throw new Error("Invalid understanding");
  if (!Array.isArray(obj.strengths)) throw new Error("Invalid strengths: must be array");
  if (!Array.isArray(obj.missingConcepts)) throw new Error("Invalid missingConcepts: must be array");
  for (const s of obj.strengths as unknown[]) {
    if (typeof s !== "string" || !s.trim()) throw new Error("Invalid strengths entry");
  }
  for (const s of obj.missingConcepts as unknown[]) {
    if (typeof s !== "string" || !s.trim()) throw new Error("Invalid missingConcepts entry");
  }
  if (!["strong", "partial", "weak"].includes(obj.reasoningQuality as string)) throw new Error("Invalid reasoningQuality");
  if (typeof obj.feedback !== "string" || !obj.feedback.trim()) throw new Error("Invalid feedback");

  return {
    score: intScore,
    understanding: (obj.understanding as string).trim(),
    strengths: (obj.strengths as string[]).map((s) => s.trim()),
    missingConcepts: (obj.missingConcepts as string[]).map((s) => s.trim()),
    reasoningQuality: obj.reasoningQuality as "strong" | "partial" | "weak",
    feedback: (obj.feedback as string).trim(),
  };
}
