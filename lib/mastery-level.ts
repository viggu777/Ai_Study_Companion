/**
 * Client-safe mastery bands (Khan-style). Pure — no server imports — so both
 * server components/services AND client components can use the single source
 * of truth. The deterministic bands are a display mapping, not evidence logic.
 */
export type MasteryLevel = "UNTESTED" | "EMERGING" | "DEVELOPING" | "PROFICIENT" | "MASTERED";

export function masteryLevelFor(score: number | null): MasteryLevel {
  if (score === null || Number.isNaN(score)) return "UNTESTED";
  if (score < 35) return "EMERGING";
  if (score < 70) return "DEVELOPING";
  if (score < 90) return "PROFICIENT";
  return "MASTERED";
}

export const MASTERY_LEVEL_META: Record<
  MasteryLevel,
  { label: string; range: string; hint: string }
> = {
  UNTESTED: { label: "Not started", range: "—", hint: "No quiz, practice, or flashcard evidence yet" },
  EMERGING: { label: "Emerging", range: "0–34", hint: "Just starting — needs foundations" },
  DEVELOPING: { label: "Developing", range: "35–69", hint: "Getting there — keep practicing" },
  PROFICIENT: { label: "Proficient", range: "70–89", hint: "Solid — stretch with harder work" },
  MASTERED: { label: "Mastered", range: "90–100", hint: "Teach it back to lock it in" },
};
