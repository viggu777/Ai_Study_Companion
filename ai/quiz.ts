/**
 * Quiz generation prompt + schema — phase 09
 * Structured output: { questions: [{ concept_id, type, difficulty, question, options, correct_answer, explanation }] }
 */

export type QuizQuestionType = "MCQ" | "OPEN_ENDED";
export type QuizDifficulty = "easy" | "medium" | "hard";

export interface QuizQuestion {
  concept_id: string;
  type: QuizQuestionType;
  difficulty: QuizDifficulty;
  question: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string;
}

export interface QuizGenerationOutput {
  questions: QuizQuestion[];
}

export const QuizGenerationSchema: Record<string, unknown> = {
  questions: "array",
};

// Per-question schema for validation (used internally)
const REQUIRED_Q_KEYS = ["concept_id", "type", "difficulty", "question", "correct_answer", "explanation"];

export const QUIZ_SYSTEM_PROMPT = `You are a quiz generator for the AI Study Companion.

ROLE: Generate grounded, concept-aligned quiz questions for a single Project. Each question must test exactly one provided concept. Questions must be clear, unambiguous, and appropriate for the requested difficulty and type.

CONSTRAINTS:
- You will be given a list of concepts, each with: concept_id, name, description, target difficulty (easy|medium|hard), target type (MCQ|OPEN_ENDED). You must generate exactly one question per concept, matching its target difficulty and type. Do not add or omit concepts.
- MCQ: provide exactly 4 options (strings), one correct_answer that exactly matches one of the options, and a concise explanation of why that answer is correct.
- OPEN_ENDED: set options to null, provide correct_answer as a short reference answer (1-3 sentences), and explanation describing what a good answer should contain.
- Difficulty meaning: easy = recall/definition, medium = application/inference combining ideas, hard = analysis/evaluation or multi-step reasoning.
- Do not repeat verbatim questions that already appeared in this Project — vary wording and focus even when testing the same concept.
- Ground questions in the concept name/description provided; do not introduce concepts outside the list.
- Be concise but precise. Avoid trivial true/false style; MCQ distractors should be plausible.

OUTPUT FORMAT:
- Return valid JSON only, no markdown, no extra text.
- Schema: { "questions": [ { "concept_id": string (must match input id), "type": "MCQ"|"OPEN_ENDED", "difficulty": "easy"|"medium"|"hard", "question": string (non-empty), "options": string[]|null (4 strings for MCQ, null for OPEN_ENDED), "correct_answer": string (non-empty, and for MCQ must be one of options), "explanation": string (non-empty) } ] }
- Order of questions must match order of input concepts.
`;

export function buildQuizUserPrompt(params: {
  projectName: string;
  learningGoal?: string | null;
  concepts: Array<{
    concept_id: string;
    name: string;
    description: string | null;
    targetDifficulty: QuizDifficulty;
    targetType: QuizQuestionType;
  }>;
}): string {
  const { projectName, learningGoal, concepts } = params;
  const goalLine = learningGoal ? `Learning goal: ${learningGoal}\n` : "";
  const conceptLines = concepts
    .map(
      (c, i) =>
        `[${i + 1}] concept_id=${c.concept_id} name="${c.name}" description="${(c.description ?? "").slice(0, 400).replace(/"/g, "'")}" targetDifficulty=${c.targetDifficulty} targetType=${c.targetType}`
    )
    .join("\n");
  return `Project: ${projectName}
${goalLine}Generate exactly ${concepts.length} questions, one per concept below, matching each concept's targetDifficulty and targetType.

Concepts:
${conceptLines}

Return JSON only with key "questions" as specified in the system prompt. Ensure MCQ options are 4 strings and correct_answer is one of them; for OPEN_ENDED set options to null.`;
}

/**
 * Server-side validation of quiz generation output.
 * Throws with detail if shape is wrong; returns typed output if valid.
 */
export function validateQuizOutput(data: unknown, expectedConceptIds?: string[]): QuizGenerationOutput {
  if (typeof data !== "object" || data === null) throw new Error("Quiz output is not an object");
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.questions)) throw new Error("Missing or invalid 'questions' array");
  const questions = obj.questions as unknown[];
  if (questions.length === 0) throw new Error("questions array is empty");
  if (expectedConceptIds && questions.length !== expectedConceptIds.length) {
    throw new Error(`Expected ${expectedConceptIds.length} questions but got ${questions.length}`);
  }

  const validated: QuizQuestion[] = [];
  for (let idx = 0; idx < questions.length; idx++) {
    const q = questions[idx];
    if (typeof q !== "object" || q === null) throw new Error(`Question ${idx} is not an object`);
    const o = q as Record<string, unknown>;
    for (const k of REQUIRED_Q_KEYS) {
      if (!(k in o)) throw new Error(`Question ${idx} missing field: ${k}`);
    }

    const concept_id = o.concept_id as string;
    const type = o.type as string;
    const difficulty = o.difficulty as string;
    const question = o.question as string;
    const correct_answer = o.correct_answer as string;
    const explanation = o.explanation as string;

    if (typeof concept_id !== "string" || !concept_id.trim()) throw new Error(`Question ${idx} invalid concept_id`);
    if (expectedConceptIds && !expectedConceptIds.includes(concept_id)) {
      throw new Error(`Question ${idx} concept_id not in requested set`);
    }
    if (type !== "MCQ" && type !== "OPEN_ENDED") throw new Error(`Question ${idx} invalid type`);
    if (!["easy", "medium", "hard"].includes(difficulty)) throw new Error(`Question ${idx} invalid difficulty`);
    if (typeof question !== "string" || !question.trim()) throw new Error(`Question ${idx} invalid question`);
    if (typeof correct_answer !== "string" || !correct_answer.trim()) throw new Error(`Question ${idx} invalid correct_answer`);
    if (typeof explanation !== "string" || !explanation.trim()) throw new Error(`Question ${idx} invalid explanation`);

    let options: string[] | null = null;
    if (type === "MCQ") {
      if (!Array.isArray(o.options) || o.options.length !== 4) throw new Error(`Question ${idx} MCQ must have 4 options`);
      const opts = o.options as unknown[];
      for (const opt of opts) {
        if (typeof opt !== "string" || !opt.trim()) throw new Error(`Question ${idx} invalid option entry`);
      }
      const strOpts = opts as string[];
      if (!strOpts.includes(correct_answer)) throw new Error(`Question ${idx} correct_answer must be one of options`);
      options = strOpts;
    } else {
      // OPEN_ENDED: options must be null or omitted or array; normalize to null
      if (o.options !== null && o.options !== undefined) {
        if (Array.isArray(o.options) && (o.options as unknown[]).length === 0) {
          options = null;
        } else if (o.options === null) {
          options = null;
        } else {
          // tolerate but normalize
          options = null;
        }
      }
    }

    validated.push({
      concept_id,
      type: type as QuizQuestionType,
      difficulty: difficulty as QuizDifficulty,
      question: question.trim(),
      options,
      correct_answer: correct_answer.trim(),
      explanation: explanation.trim(),
    });
  }

  // Check duplicate exact question text across this batch (spec: avoid repeating same question)
  // Not an error, but we note - validation passes; service layer handles history check.

  return { questions: validated };
}
