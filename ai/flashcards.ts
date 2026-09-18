/**
 * Flashcard generation prompt + schema.
 * Structured output: { cards: [{ concept_id, front, back }] }
 */

export interface Flashcard {
  concept_id: string;
  front: string;
  back: string;
}

export interface FlashcardGenerationOutput {
  cards: Flashcard[];
}

export const FlashcardGenerationSchema: Record<string, unknown> = {
  cards: "array",
};

export const FLASHCARD_SYSTEM_PROMPT = `You are a flashcard author for the AI Study Companion.

ROLE: Create concise, study-ready flashcards grounded in the provided concepts. Each card tests exactly one concept: front = question/prompt/term, back = answer/definition (1-3 sentences).

CONSTRAINTS:
- You will be given a list of concepts, each with: concept_id, name, description. Generate exactly one flashcard per concept, in input order. Do not add or omit concepts.
- Front: short prompt (max ~140 chars), e.g. a question, term to define, or fill-in-the-blank. No answers on the front.
- Back: direct answer grounded in the concept name/description (1-3 sentences, max ~400 chars). No new concepts.
- Be precise and unambiguous. Avoid trivial true/false style.
- Do not repeat concepts outside the list.

OUTPUT FORMAT:
- Return valid JSON only, no markdown, no extra text.
- Schema: { "cards": [ { "concept_id": string (must match input id), "front": string (non-empty), "back": string (non-empty) } ] }
`;

export function buildFlashcardUserPrompt(params: {
  projectName: string;
  concepts: Array<{ concept_id: string; name: string; description: string | null }>;
}): string {
  const { projectName, concepts } = params;
  const lines = concepts
    .map(
      (c, i) =>
        `[${i + 1}] concept_id=${c.concept_id} name="${c.name}" description="${(c.description ?? "").slice(0, 400).replace(/"/g, "'")}"`
    )
    .join("\n");
  return `Project: ${projectName}
Generate exactly ${concepts.length} flashcards, one per concept below.

Concepts:
${lines}

Return JSON only with key "cards" as specified in the system prompt.`;
}

/** Server-side validation — throws with detail, returns typed output. */
export function validateFlashcardOutput(data: unknown, expectedConceptIds?: string[]): FlashcardGenerationOutput {
  if (typeof data !== "object" || data === null) throw new Error("Flashcard output is not an object");
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.cards)) throw new Error("Missing or invalid 'cards' array");
  const cards = obj.cards as unknown[];
  if (cards.length === 0) throw new Error("cards array is empty");
  if (expectedConceptIds && cards.length !== expectedConceptIds.length) {
    throw new Error(`Expected ${expectedConceptIds.length} cards but got ${cards.length}`);
  }
  const validated: Flashcard[] = [];
  for (let idx = 0; idx < cards.length; idx++) {
    const c = cards[idx];
    if (typeof c !== "object" || c === null) throw new Error(`Card ${idx} is not an object`);
    const o = c as Record<string, unknown>;
    const concept_id = o.concept_id as string;
    const front = o.front as string;
    const back = o.back as string;
    if (typeof concept_id !== "string" || !concept_id.trim()) throw new Error(`Card ${idx} invalid concept_id`);
    if (expectedConceptIds && !expectedConceptIds.includes(concept_id)) {
      throw new Error(`Card ${idx} concept_id not in requested set`);
    }
    if (typeof front !== "string" || !front.trim() || front.trim().length > 300) {
      throw new Error(`Card ${idx} invalid front`);
    }
    if (typeof back !== "string" || !back.trim() || back.trim().length > 1000) {
      throw new Error(`Card ${idx} invalid back`);
    }
    validated.push({ concept_id, front: front.trim(), back: back.trim() });
  }
  return { cards: validated };
}
