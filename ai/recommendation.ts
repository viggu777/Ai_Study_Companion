/**
 * Recommendation prompt + schema — phase 12 Part B
 * Structured output: { title, action_items: string[] }
 * Must name actual concepts/materials/page ranges, not generic "keep studying".
 */

export interface RecommendationOutput {
  title: string;
  action_items: string[];
}

export const RecommendationSchema: Record<string, unknown> = {
  title: "string",
  action_items: "array",
};

export const RECOMMENDATION_SYSTEM_PROMPT = `You are a learning recommendation engine for the AI Study Companion.

ROLE: Produce specific, actionable study recommendations grounded in the learner's weak concepts, recent mistakes, mastery scores, learning goal, and recent activity. Your output directly becomes a user's next study tasks — be concrete.

CRITICAL RULES — AVOID GENERIC OUTPUT:
- NEVER output generic phrases like "keep studying", "practice more", "review material", "stay consistent" without naming a specific concept.
- EVERY action_item must name at least one real concept from the provided weak/failed list, and where available cite a material name and page range (e.g. "Re-read Data Structures — Linked Lists pp. 12-15").
- Provide 2-4 action_items. Each item must be a single, concrete task: what to do + which concept/material/page + expected outcome.
- Title: short (6-10 words), names the primary weak concept or theme, e.g. "Strengthen Recursion Before Tackling DP" or "Close the Gap on Photosynthesis Light Reactions".
- If materials/page ranges are provided, use them. If not, still name the concept explicitly.

OUTPUT FORMAT:
- Return valid JSON only, no markdown, no extra text.
- Schema: { "title": string (non-empty, <=120 chars), "action_items": string[] (2-4 items, each non-empty, each must reference a concept by name) }
- Example good action_items:
  ["Re-read 'Intro to Biology' Ch. 4 Photosynthesis pp. 18-24 focusing on light-dependent reactions",
   "Retake the Photosynthesis quiz (medium difficulty) and aim for ≥80% before moving on",
   "In Tutor, ask: 'Explain the difference between photosystem I and II with a diagram from the material'"]
- Bad (will be rejected): ["Keep studying hard", "Review your materials", "Practice more questions"]

You will be given: weak concepts (with mastery + trend), recent mistakes (concept + question), mastery snapshot (all concepts), learning goal, recent activity (events), and materials context (concept → material + pages). Use them to ground every item.`;

export function buildRecommendationUserPrompt(params: {
  projectName: string;
  learningGoal?: string | null;
  weakConcepts: Array<{ conceptId: string; name: string; description: string | null; masteryScore: number; trend?: string | null }>;
  recentMistakes: Array<{ conceptName: string; question: string; score: number | null }>;
  masterySnapshot: Array<{ conceptName: string; masteryScore: number; trend: string }>;
  recentActivity: Array<{ eventType: string; createdAt: string; metadata?: unknown }>;
  materialsContext: Array<{ conceptName: string; materialName: string | null; materialId: string | null; pages?: string | null }>;
  practiceContext?: Array<{ conceptName: string; detail: string }>;
  misconceptionContext?: Array<{ conceptName: string; description: string; occurrences: number }>;
  prerequisiteNotes?: string[];
}): string {
  const { projectName, learningGoal, weakConcepts, recentMistakes, masterySnapshot, recentActivity, materialsContext, practiceContext, misconceptionContext, prerequisiteNotes } = params;

  const weakBlock =
    weakConcepts.length === 0
      ? "(no weak concepts — all mastery ≥60 and no REQUIRES_ATTENTION)"
      : weakConcepts
          .map((c) => `- ${c.name} (mastery ${c.masteryScore}, trend ${c.trend ?? "unknown"}) — ${c.description ?? "(no description)"} — id ${c.conceptId}`)
          .join("\n");

  const mistakeBlock =
    recentMistakes.length === 0
      ? "(no recent mistakes in last quizzes)"
      : recentMistakes.map((m) => `- [${m.conceptName}] "${m.question.slice(0, 160)}" score ${m.score ?? "N/A"}`).join("\n");

  const masteryBlock =
    masterySnapshot.length === 0
      ? "(no mastery data)"
      : masterySnapshot.map((m) => `- ${m.conceptName}: ${m.masteryScore} (${m.trend})`).join("\n");

  const activityBlock =
    recentActivity.length === 0
      ? "(no recent activity)"
      : recentActivity.map((a) => `- ${a.eventType} at ${a.createdAt}`).join("\n");

  const materialBlock =
    materialsContext.length === 0
      ? "(no material mapping available — still name concepts explicitly)"
      : materialsContext
          .map(
            (m) =>
              `- Concept "${m.conceptName}" → material "${m.materialName ?? "(none)"}"${m.pages ? ` pages ${m.pages}` : ""}${m.materialId ? ` (id ${m.materialId})` : ""}`
          )
          .join("\n");

  const practiceBlock =
    !practiceContext || practiceContext.length === 0
      ? ""
      : `\nPRACTICE EVIDENCE (deep open-ended practice — what the learner demonstrated):\n${practiceContext.map((p) => `- [${p.conceptName}] ${p.detail.slice(0, 220)}`).join("\n")}\n`;

  const misconceptionBlock =
    !misconceptionContext || misconceptionContext.length === 0
      ? ""
      : `\nRECURRING MISCONCEPTIONS (address these directly — repetition increases priority):\n${misconceptionContext.map((m) => `- [${m.conceptName}] "${m.description.slice(0, 160)}" (seen ${m.occurrences}x)`).join("\n")}\n`;

  const prereqBlock =
    !prerequisiteNotes || prerequisiteNotes.length === 0
      ? ""
      : `\nDEPENDENCY NOTES (practice the prerequisite FIRST):\n${prerequisiteNotes.map((n) => `- ${n.slice(0, 220)}`).join("\n")}\n`;

  return `Project: ${projectName}
Learning goal: ${learningGoal ?? "(none set)"}

WEAK CONCEPTS (priority — REQUIRES_ATTENTION or mastery <60):
${weakBlock}

RECENT MISTAKES (last quiz attempts):
${mistakeBlock}
${practiceBlock}${misconceptionBlock}${prereqBlock}
MASTERY SNAPSHOT (all concepts):
${masteryBlock}

RECENT ACTIVITY (last events):
${activityBlock}

MATERIALS CONTEXT (concept → source material + page range):
${materialBlock}

TASK: Generate ONE recommendation that is specific to the weak concepts above. Title must name the primary weak concept. Each action_item must name an actual concept (and where possible a material + page range). Prefer: reattempt a concept, review a specific material section, practice a prerequisite first, try an application-based question, or ask the Tutor for clarification. Do NOT produce generic advice. Return JSON only.`;
}

export function validateRecommendationOutput(data: unknown): RecommendationOutput {
  if (typeof data !== "object" || data === null) throw new Error("Recommendation output is not an object");
  const obj = data as Record<string, unknown>;
  if (typeof obj.title !== "string" || obj.title.trim().length === 0) throw new Error("Missing or invalid title");
  if (obj.title.trim().length > 120) throw new Error("Title too long (>120 chars)");
  if (!Array.isArray(obj.action_items)) throw new Error("Missing or invalid action_items");
  const items = obj.action_items as unknown[];
  if (items.length < 2 || items.length > 5) throw new Error(`action_items length must be 2-5, got ${items.length}`);
  const validated: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (typeof it !== "string" || it.trim().length === 0) throw new Error(`action_items[${i}] must be non-empty string`);
    if (it.trim().length < 10) throw new Error(`action_items[${i}] too short — must be specific`);
    validated.push(it.trim());
  }
  // Heuristic guard against generic output: at least one item mentions a concept-like capitalized phrase
  // We keep this lightweight; stricter check happens by prompting, but we reject obvious generics
  const generics = ["keep studying", "stay consistent", "practice more", "review material", "keep up", "good job"];
  const lowerItems = validated.map((s) => s.toLowerCase());
  const genericHits = lowerItems.filter((s) => generics.some((g) => s === g || (s.length < 20 && s.includes(g))));
  if (genericHits.length > 0 && validated.every((s) => s.length < 30)) {
    throw new Error("Recommendation action_items appear generic — must name specific concepts/materials");
  }
  return { title: obj.title.trim(), action_items: validated };
}
