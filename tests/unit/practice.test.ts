import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  validatePracticeGenerationOutput,
  validatePracticeEvaluationOutput,
  buildPracticeGenerationUserPrompt,
  buildPracticeEvaluationUserPrompt,
  normalizeMisconception,
  misconceptionSimilarity,
  calibrateConfidence,
  clampPracticeCount,
  PRACTICE_GENERATION_SYSTEM_PROMPT,
  PRACTICE_EVALUATION_SYSTEM_PROMPT,
  PracticeEvaluationSchema,
  PRACTICE_DEFAULT_COUNT,
  PRACTICE_MAX_COUNT,
  PRACTICE_MIN_COUNT,
} from "@/ai/practice";
import { clampQuizCount, QUIZ_DEFAULT_COUNT, QUIZ_MAX_COUNT, QUIZ_MIN_COUNT } from "@/ai/quiz";
import {
  computePracticeScore,
  pickPracticeIntent,
  pickPracticeDifficulty,
  pickPracticeQuestionType,
  ensurePracticeTypeMix,
  practiceEvidenceFor,
  buildPracticeHistoryReason,
  stripPracticeQuestionForTaking,
  gatePracticeQuestionForReview,
  mapMentionsToConceptIds,
  isMissingTableError,
  isMissingPracticeMcqColumnError,
  PRACTICE_SETUP_MESSAGE,
  PRACTICE_MCQ_SETUP_MESSAGE,
} from "@/services/practice.service";
import {
  confidenceForEvidenceCount,
  isEdgeValidated,
  weakPrerequisitesFirst,
  selectPrerequisitesFor,
} from "@/services/knowledge-graph.service";
import { computeNewMastery } from "@/services/mastery.service";
import { buildRecommendationUserPrompt } from "@/ai/recommendation";

const ROOT = path.resolve(__dirname, "../..");
const CID_A = "11111111-1111-4111-8111-111111111111";
const CID_B = "22222222-2222-4222-8222-222222222222";
const CID_C = "33333333-3333-4333-8333-333333333333";

function validGenRaw() {
  return {
    questions: [
      {
        concept_id: CID_A,
        related_concept_ids: [CID_B],
        subconcept_label: "chain rule intuition",
        intent: "EXPLAIN",
        difficulty: "easy",
        question_type: "OPEN_ENDED",
        question: "Explain how gradient descent updates weights and why the learning rate matters for convergence in your own words?",
        options: null,
        correct_answer: null,
        explanation: null,
        reference_answer: "Strong answer describes iterative updates opposite the gradient and the trade-off of too-large vs too-small rates.",
        selection_reason: "mastery 32 + sign-error misconception",
      },
      {
        concept_id: CID_B,
        related_concept_ids: [],
        subconcept_label: null,
        intent: "APPLY",
        difficulty: "medium",
        question_type: "MCQ",
        question: "You run gradient descent on f(w) = w^2 from w=4 with learning rate 0.1. What is w after one update?",
        options: ["3.2", "3.6", "4.0", "2.4"],
        correct_answer: "3.2",
        explanation: "grad = 2w = 8, so w := 4 - 0.1*8 = 3.2.",
        reference_answer: null,
        selection_reason: "recent mistake on step-size question",
      },
    ],
    suggested_edges: [{ from_concept_id: CID_B, to_concept_id: CID_A, relation: "PREREQUISITE" }],
  };
}

function validEvalRaw() {
  return {
    score: 72,
    understanding_level: "PROFICIENT",
    concepts_demonstrated: ["gradient update rule"],
    concepts_partial: ["learning-rate trade-off"],
    missing_concepts: ["convergence conditions"],
    misconceptions: [],
    reasoning_quality: "partial",
    evidence_grounding: "partial",
    feedback: "Solid update rule, learning-rate reasoning is close.",
    suggested_improvement: "Re-explain what happens when the rate is 10x too large with one numeric example.",
  };
}

describe("practice generation validation", () => {
  it("accepts a valid mixed MCQ + open-ended batch + edge proposal", () => {
    const out = validatePracticeGenerationOutput(validGenRaw(), [CID_A, CID_B]);
    expect(out.questions).toHaveLength(2);
    expect(out.questions[0].intent).toBe("EXPLAIN");
    expect(out.questions[0].question_type).toBe("OPEN_ENDED");
    expect(out.questions[1].question_type).toBe("MCQ");
    expect(out.questions[1].options).toHaveLength(4);
    expect(out.questions[1].correct_answer).toBe("3.2");
    expect(out.suggested_edges).toHaveLength(1);
  });

  it("rejects malformed output per type", () => {
    expect(() => validatePracticeGenerationOutput({ questions: [] }, [CID_A])).toThrow();
    expect(() => validatePracticeGenerationOutput({ questions: [{ concept_id: CID_A }] }, [CID_A])).toThrow();
    expect(() =>
      validatePracticeGenerationOutput(
        { questions: [{ ...validGenRaw().questions[0], intent: "MCQ" }], suggested_edges: [] },
        [CID_A]
      )
    ).toThrow(/intent/);
    // MCQ without 4 options or with an answer outside options.
    expect(() =>
      validatePracticeGenerationOutput(
        { questions: [{ ...validGenRaw().questions[1], options: ["only", "two"] }], suggested_edges: [] },
        [CID_B]
      )
    ).toThrow(/4 options/);
    expect(() =>
      validatePracticeGenerationOutput(
        { questions: [{ ...validGenRaw().questions[1], correct_answer: "not an option" }], suggested_edges: [] },
        [CID_B]
      )
    ).toThrow(/one of options/);
    // MCQ must not carry a reference answer; open-ended must not carry options.
    expect(() =>
      validatePracticeGenerationOutput(
        { questions: [{ ...validGenRaw().questions[1], reference_answer: "leak" }], suggested_edges: [] },
        [CID_B]
      )
    ).toThrow(/reference_answer/);
    expect(() =>
      validatePracticeGenerationOutput(
        { questions: [{ ...validGenRaw().questions[0], options: ["a", "b", "c", "d"] }], suggested_edges: [] },
        [CID_A]
      )
    ).toThrow(/options/);
    expect(() =>
      validatePracticeGenerationOutput(
        { questions: [{ ...validGenRaw().questions[0], question_type: "FILL_BLANK" }], suggested_edges: [] },
        [CID_A]
      )
    ).toThrow(/question_type/);
  });

  it("rejects unknown concept ids and self-loop edges", () => {
    const raw = validGenRaw();
    expect(() => validatePracticeGenerationOutput(raw, [CID_A])).toThrow(/Expected 1/);
    const badEdge = {
      ...validGenRaw(),
      suggested_edges: [{ from_concept_id: CID_A, to_concept_id: CID_A, relation: "PREREQUISITE" }],
    };
    expect(() => validatePracticeGenerationOutput(badEdge, [CID_A, CID_B])).toThrow(/self-loop/);
    const foreignEdge = {
      ...validGenRaw(),
      suggested_edges: [{ from_concept_id: CID_A, to_concept_id: CID_C, relation: "RELATED" }],
    };
    expect(() => validatePracticeGenerationOutput(foreignEdge, [CID_A, CID_B])).toThrow(/not in requested set/);
  });

  it("rejects too-short questions (no trivia / yes-no)", () => {
    const raw = validGenRaw();
    (raw.questions[0] as Record<string, unknown>).question = "What is lr?";
    expect(() => validatePracticeGenerationOutput(raw, [CID_A, CID_B])).toThrow(/too short/);
  });

  it("generation prompt requests mixed MCQ + open-ended and carries untrusted-data guard", () => {
    expect(PRACTICE_GENERATION_SYSTEM_PROMPT).toMatch(/multiple-choice/i);
    expect(PRACTICE_GENERATION_SYSTEM_PROMPT).toMatch(/open-ended/i);
    expect(PRACTICE_GENERATION_SYSTEM_PROMPT).toMatch(/UNTRUSTED DATA/);
    const prompt = buildPracticeGenerationUserPrompt({
      projectName: "ML Basics",
      learningGoal: "ace optimization",
      concepts: [
        { concept_id: CID_A, name: "Gradient Descent", description: "iterative optimizer", mastery: 32, trend: "declining", isRecentMistake: true, misconceptions: ["larger lr always better"], targetIntent: "WHY", targetDifficulty: "medium", targetType: "OPEN_ENDED", materialHint: "notes.pdf" },
        { concept_id: CID_B, name: "Learning Rate", description: "step-size scale", mastery: 55, trend: "stable", isRecentMistake: true, misconceptions: [], targetIntent: "APPLY", targetDifficulty: "medium", targetType: "MCQ", materialHint: "notes.pdf" },
      ],
      evidence: ["[Gradient Descent] update opposite gradient"],
    });
    expect(prompt).toContain(CID_A);
    expect(prompt).toContain("WHY");
    expect(prompt).toContain("targetType=MCQ");
    expect(prompt).toContain("<retrieved_evidence>");
  });
});

describe("practice evaluation validation (evidence, not just score)", () => {
  it("accepts rich evidence output", () => {
    const out = validatePracticeEvaluationOutput(validEvalRaw());
    expect(out.score).toBe(72);
    expect(out.understanding_level).toBe("PROFICIENT");
    expect(out.reasoning_quality).toBe("partial");
  });

  it("accepts legacy reasoningQuality key", () => {
    const raw = { ...validEvalRaw(), reasoning_quality: undefined, reasoningQuality: "strong" } as unknown as Record<string, unknown>;
    delete raw.reasoning_quality;
    const out = validatePracticeEvaluationOutput(raw);
    expect(out.reasoning_quality).toBe("strong");
  });

  it("rejects invalid score / level mismatch / missing improvement", () => {
    expect(() => validatePracticeEvaluationOutput({ ...validEvalRaw(), score: 150 })).toThrow(/score/);
    expect(() => validatePracticeEvaluationOutput({ ...validEvalRaw(), score: 95, understanding_level: "EMERGING" })).toThrow(/inconsistent/);
    expect(() => validatePracticeEvaluationOutput({ ...validEvalRaw(), suggested_improvement: " " })).toThrow();
    expect(() => validatePracticeEvaluationOutput({ ...validEvalRaw(), reasoning_quality: "great" })).toThrow();
    expect(() => validatePracticeEvaluationOutput({ ...validEvalRaw(), evidence_grounding: "maybe" })).toThrow();
  });

  it("evaluation prompt separates intent + evidence block", () => {
    expect(PRACTICE_EVALUATION_SYSTEM_PROMPT).toMatch(/backend decides mastery|produces.*evidence/i);
    const prompt = buildPracticeEvaluationUserPrompt({
      question: "Why does a large lr diverge?",
      intent: "WHY",
      referenceAnswer: "overshoots minima",
      conceptName: "Gradient Descent",
      conceptDescription: "optimizer",
      relatedConcepts: ["Learning Rate"],
      materialEvidence: ["lr scales the step"],
      studentResponse: "because steps are too big and bounce",
    });
    expect(prompt).toContain("WHY");
    expect(prompt).toContain("<retrieved_evidence>");
  });
});

describe("practice adaptive selection (multi-signal, not wrong->easy)", () => {
  it("combines mastery + mistake + trend + misconception + prerequisite, penalizes recency/frequency", () => {
    const base = { mastery: 50, trendDelta: 0, isRecentMistake: false, daysSinceLastTest: 999, frequencyCount: 0, misconceptionCount: 0, misconceptionOccurrences: 0, isPrerequisiteForWeak: false };
    const weak = computePracticeScore({ ...base, mastery: 20 });
    const strong = computePracticeScore({ ...base, mastery: 90 });
    expect(weak).toBeGreaterThan(strong);

    const withMistake = computePracticeScore({ ...base, mastery: 50, isRecentMistake: true });
    const without = computePracticeScore({ ...base, mastery: 50 });
    expect(withMistake - without).toBeCloseTo(20, 5);

    const withMisc = computePracticeScore({ ...base, mastery: 70, misconceptionCount: 1, misconceptionOccurrences: 2 });
    expect(withMisc).toBeGreaterThan(computePracticeScore({ ...base, mastery: 70 }));

    const prereq = computePracticeScore({ ...base, mastery: 60, isPrerequisiteForWeak: true });
    expect(prereq - computePracticeScore({ ...base, mastery: 60 })).toBeCloseTo(10, 5);

    const recent = computePracticeScore({ ...base, mastery: 30, daysSinceLastTest: 1 });
    expect(recent).toBeLessThan(computePracticeScore({ ...base, mastery: 30, daysSinceLastTest: 999 }));
  });

  it("picks intent from weakness/history, not a single rule", () => {
    expect(pickPracticeIntent({ mastery: 20, isRecentMistake: false, misconceptionCount: 0, misconceptionOccurrences: 0, trendDelta: 0, frequencyCount: 0 })).toBe("EXPLAIN");
    expect(pickPracticeIntent({ mastery: 50, isRecentMistake: false, misconceptionCount: 1, misconceptionOccurrences: 1, trendDelta: 0, frequencyCount: 0 })).toBe("WHY");
    expect(pickPracticeIntent({ mastery: 50, isRecentMistake: false, misconceptionCount: 1, misconceptionOccurrences: 4, trendDelta: 0, frequencyCount: 0 })).toBe("TEACH_BACK");
    expect(pickPracticeIntent({ mastery: 55, isRecentMistake: false, misconceptionCount: 0, misconceptionOccurrences: 0, trendDelta: 0, frequencyCount: 0 })).toBe("APPLY");
    expect(pickPracticeIntent({ mastery: 90, isRecentMistake: false, misconceptionCount: 0, misconceptionOccurrences: 0, trendDelta: 0, frequencyCount: 3 })).toBe("TEACH_BACK");
  });

  it("difficulty follows mastery + intent depth", () => {
    expect(pickPracticeDifficulty(20, "EXPLAIN")).toBe("easy");
    expect(pickPracticeDifficulty(90, "APPLY")).toBe("hard");
    expect(pickPracticeDifficulty(60, "SCENARIO")).toBe("hard");
    expect(pickPracticeDifficulty(50, "SCENARIO")).toBe("medium");
  });
});

describe("practice question types (mixed MCQ + open-ended)", () => {
  it("picks MCQ for shaky application-style work, open-ended for explanation", () => {
    expect(pickPracticeQuestionType({ mastery: 30, isRecentMistake: false, misconceptionCount: 0, intent: "EXPLAIN" })).toBe("OPEN_ENDED");
    expect(pickPracticeQuestionType({ mastery: 90, isRecentMistake: false, misconceptionCount: 0, intent: "TEACH_BACK" })).toBe("OPEN_ENDED");
    expect(pickPracticeQuestionType({ mastery: 80, isRecentMistake: false, misconceptionCount: 0, intent: "WHY" })).toBe("OPEN_ENDED");
    expect(pickPracticeQuestionType({ mastery: 50, isRecentMistake: false, misconceptionCount: 1, intent: "APPLY" })).toBe("OPEN_ENDED");
    expect(pickPracticeQuestionType({ mastery: 55, isRecentMistake: true, misconceptionCount: 0, intent: "APPLY" })).toBe("MCQ");
    expect(pickPracticeQuestionType({ mastery: 45, isRecentMistake: false, misconceptionCount: 0, intent: "COMPARE" })).toBe("MCQ");
    expect(pickPracticeQuestionType({ mastery: 80, isRecentMistake: false, misconceptionCount: 0, intent: "SCENARIO" })).toBe("OPEN_ENDED");
  });

  it("guarantees a mixed assignment when count >= 2", () => {
    const mk = (intent: "EXPLAIN" | "WHY" | "APPLY" | "COMPARE", mastery: number, targetType: "MCQ" | "OPEN_ENDED") => ({ targetIntent: intent, mastery, targetType });
    const allOpen = ensurePracticeTypeMix([mk("EXPLAIN", 30, "OPEN_ENDED"), mk("WHY", 40, "OPEN_ENDED"), mk("APPLY", 60, "OPEN_ENDED")]);
    expect(allOpen.map((c) => c.targetType)).toContain("MCQ");
    expect(allOpen.map((c) => c.targetType)).toContain("OPEN_ENDED");
    // Flips an MCQ-friendly intent, not the explanation question.
    expect(allOpen[0].targetType).toBe("OPEN_ENDED");
    expect(allOpen[2].targetType).toBe("MCQ");
    const allMcq = ensurePracticeTypeMix([mk("APPLY", 40, "MCQ"), mk("COMPARE", 50, "MCQ")]);
    expect(allMcq.map((c) => c.targetType)).toContain("OPEN_ENDED");
    expect(allMcq.map((c) => c.targetType)).toContain("MCQ");
    // Single-question assignments are untouched.
    expect(ensurePracticeTypeMix([mk("EXPLAIN", 30, "OPEN_ENDED")])).toEqual([mk("EXPLAIN", 30, "OPEN_ENDED")]);
    // Already-mixed assignments are untouched.
    const mixed = [mk("EXPLAIN", 30, "OPEN_ENDED"), mk("APPLY", 50, "MCQ")];
    expect(ensurePracticeTypeMix(mixed)).toEqual(mixed);
  });

  it("evaluation schema accepts the documented single reasoning_quality key", () => {
    // Regression: the schema once required BOTH reasoningQuality and
    // reasoning_quality, so generateStructured rejected every compliant LLM
    // output and all practice grading failed as "temporarily unavailable".
    const keys = Object.keys(PracticeEvaluationSchema);
    expect(keys).toContain("reasoning_quality");
    expect(keys).not.toContain("reasoningQuality");
  });
});

describe("practice mastery evidence (deterministic, explainable)", () => {
  it("maps primary/secondary evidence without LLM discretion", () => {
    expect(practiceEvidenceFor("primary", 72)).toBe(72);
    expect(practiceEvidenceFor("demonstrated", 40)).toBe(80);
    expect(practiceEvidenceFor("partial", 90)).toBe(50);
    expect(practiceEvidenceFor("missing", 90)).toBe(30);
    expect(practiceEvidenceFor("missing", 12)).toBe(12);
  });

  it("history reason is stable per assignment+question+concept (idempotency key)", () => {
    const r = buildPracticeHistoryReason("a1", "q1", CID_A, "primary", 72);
    expect(r).toContain("practice:a1:q1:");
    expect(r).toContain(CID_A);
    expect(r).toContain("source:primary");
  });

  it("reuses the 0.7/0.3 formula on practice evidence", () => {
    expect(computeNewMastery(54, practiceEvidenceFor("primary", 72))).toBe(computeNewMastery(54, 72));
    // Example from the task: 54 -> ~68 needs strong repeated evidence, not one answer.
    const one = computeNewMastery(54, 72);
    expect(one).toBeLessThan(68);
    expect(one).toBeGreaterThan(54);
  });
});

describe("knowledge graph (lightweight, validated)", () => {
  it("confidence grows only with repeated evidence; trust needs >=2", () => {
    expect(confidenceForEvidenceCount(1)).toBe(0.5);
    expect(confidenceForEvidenceCount(2)).toBe(0.6);
    expect(confidenceForEvidenceCount(10)).toBeLessThanOrEqual(0.95);
    expect(isEdgeValidated(1)).toBe(false);
    expect(isEdgeValidated(2)).toBe(true);
  });

  it("prerequisite-first helper surfaces weak dependencies", () => {
    const edges = [
      { from_concept_id: CID_B, to_concept_id: CID_A, relation: "PREREQUISITE" },
      { from_concept_id: CID_C, to_concept_id: CID_A, relation: "RELATED" },
    ];
    const mastery = new Map([[CID_A, 40], [CID_B, 30], [CID_C, 20]]);
    expect(weakPrerequisitesFirst(CID_A, edges, mastery)).toEqual([CID_B]);
    expect(selectPrerequisitesFor(edges.map((e) => ({ ...e, evidence_count: 2 })), CID_A)).toEqual([CID_B]);
  });

  it("migration creates relational graph tables (no graph DB)", () => {
    const sql = fs.readFileSync(path.join(ROOT, "db/schema/007_practice.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS concept_edges");
    expect(sql).toContain("PREREQUISITE");
    expect(sql).toContain("UNIQUE (project_id, from_concept_id, to_concept_id, relation)");
    expect(sql).toContain("CHECK (from_concept_id != to_concept_id)");
    expect(sql).not.toMatch(/neo4j|cypher|arangodb|janusgraph/i);
  });
});

describe("misconceptions + confidence calibration", () => {
  it("normalizes and fuzzy-matches recurring patterns", () => {
    expect(normalizeMisconception("  Larger LR ALWAYS improves convergence!! ")).toBe("larger lr always improves convergence");
    const sim = misconceptionSimilarity("larger learning rate always improves convergence", "Larger learning rate always improves convergence!");
    expect(sim).toBeGreaterThan(0.9);
    expect(misconceptionSimilarity("gradient points uphill", "learning rate schedules")).toBeLessThan(0.4);
  });

  it("calibrates confidence vs demonstrated understanding", () => {
    expect(calibrateConfidence(5, 30)).toBe("OVERCONFIDENT");
    expect(calibrateConfidence(1, 95)).toBe("UNDERCONFIDENT");
    expect(calibrateConfidence(3, 70)).toBe("CALIBRATED");
    expect(calibrateConfidence(null, 70)).toBe("UNKNOWN");
  });

  it("migration tracks misconceptions per learner+concept with counts", () => {
    const sql = fs.readFileSync(path.join(ROOT, "db/schema/007_practice.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS misconceptions");
    expect(sql).toContain("occurrence_count");
    expect(sql).toContain("UNIQUE (project_id, user_id, concept_id, normalized)");
  });
});

describe("practice persistence: idempotency + isolation", () => {
  it("migration enforces per-question idempotency and RLS", () => {
    const sql = fs.readFileSync(path.join(ROOT, "db/schema/007_practice.sql"), "utf8");
    expect(sql).toContain("UNIQUE (question_id, user_id)");
    expect(sql).toContain("uq_learning_events_practice_completed");
    expect(sql).toContain("ROW LEVEL SECURITY");
    expect(sql).toContain("practice_assignments_user_isolation");
  });

  it("practice API routes authenticate, map 404, and stay thin", () => {
    const files = [
      "app/api/projects/[projectId]/practice/route.ts",
      "app/api/projects/[projectId]/practice/[assignmentId]/route.ts",
      "app/api/projects/[projectId]/practice/[assignmentId]/submit/route.ts",
      "app/api/projects/[projectId]/practice/[assignmentId]/summary/route.ts",
      "app/api/projects/[projectId]/knowledge-graph/route.ts",
      "app/api/projects/[projectId]/misconceptions/route.ts",
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel} auth`).toContain("requireUserId(");
      expect(src, `${rel} 401`).toContain("401");
      expect(src, `${rel} thin`).not.toContain('from("');
    }
  });

  it("question gating hides answers until graded but keeps MCQ options", () => {
    const mcq = { id: "q1", concept_id: CID_A, question_type: "MCQ", question: "Pick one.", options: ["a", "b", "c", "d"], correct_answer: "b", explanation: "because b", reference_answer: null, selection_reason: "weak" };
    const stripped = stripPracticeQuestionForTaking({ ...mcq });
    expect(stripped).not.toHaveProperty("reference_answer");
    expect(stripped).not.toHaveProperty("correct_answer");
    expect(stripped).not.toHaveProperty("explanation");
    expect(stripped.options).toEqual(["a", "b", "c", "d"]);
    expect(stripped.answered).toBe(false);
    const gated = gatePracticeQuestionForReview({ ...mcq }, false);
    expect(gated.reference_answer).toBeNull();
    expect(gated.correct_answer).toBeNull();
    expect(gated.explanation).toBeNull();
    expect(gated.options).toEqual(["a", "b", "c", "d"]);
    const shown = gatePracticeQuestionForReview({ id: "q1", concept_id: CID_A, question: "Why?", reference_answer: "secret", correct_answer: null, explanation: null }, true);
    expect(shown.reference_answer).toBe("secret");
  });

  it("mention mapping resolves free text to real project concepts only", () => {
    const concepts = [
      { id: CID_A, name: "Gradient Descent" },
      { id: CID_B, name: "Learning Rate" },
    ];
    const hits = mapMentionsToConceptIds(["gradient update rule needs Gradient Descent", "totally unknown idea xyz"], concepts);
    expect(hits.map((h) => h.conceptId)).toContain(CID_A);
    expect(hits.map((h) => h.conceptId)).not.toContain("unknown");
  });
});

describe("practice recommendations use learner state + materials", () => {
  it("prompt carries practice evidence, misconceptions, and prerequisite notes", () => {
    const prompt = buildRecommendationUserPrompt({
      projectName: "ML",
      learningGoal: "master optimization",
      weakConcepts: [{ conceptId: CID_A, name: "Gradient Descent", description: "optimizer", masteryScore: 40, trend: "STABLE" }],
      recentMistakes: [{ conceptName: "Gradient Descent", question: "step size?", score: 30 }],
      masterySnapshot: [{ conceptName: "Gradient Descent", masteryScore: 40, trend: "STABLE" }],
      recentActivity: [{ eventType: "PRACTICE_COMPLETED", createdAt: "2026-01-01" }],
      materialsContext: [{ conceptName: "Gradient Descent", materialName: "notes.pdf", materialId: "m1", pages: "pp. 2-5" }],
      practiceContext: [{ conceptName: "Gradient Descent", detail: 'WHY "why diverge?" → score 35 (DEVELOPING)' }],
      misconceptionContext: [{ conceptName: "Gradient Descent", description: "larger lr always better", occurrences: 3 }],
      prerequisiteNotes: ['Practice "Learning Rate" before "Gradient Descent"'],
    });
    expect(prompt).toMatch(/PRACTICE EVIDENCE/);
    expect(prompt).toMatch(/RECURRING MISCONCEPTIONS/);
    expect(prompt).toMatch(/DEPENDENCY NOTES/);
    expect(prompt).toContain("notes.pdf");
  });
});

describe("missing-table resilience (007 migration not applied)", () => {
  it("detects PostgREST schema-cache + Postgres 42P01 shapes", () => {
    expect(isMissingTableError({ code: "PGRST205", message: "Could not find the table 'public.practice_assignments' in the schema cache" })).toBe(true);
    expect(isMissingTableError({ code: "42P01", message: 'relation "public.misconceptions" does not exist' })).toBe(true);
    expect(isMissingTableError(new Error("Could not find the table 'public.concept_edges' in the schema cache"), "concept_edges")).toBe(true);
    expect(isMissingTableError(new Error("relation \"practice_responses\" does not exist"))).toBe(true);
  });

  it("does not flag unrelated errors as missing tables", () => {
    expect(isMissingTableError(new Error("Project not found"))).toBe(false);
    expect(isMissingTableError(new Error("Failed to fetch"))).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
  });

  it("setup message points at the 007 migration", () => {
    expect(PRACTICE_SETUP_MESSAGE).toContain("007_practice.sql");
  });

  it("008 migration adds MCQ columns and maps setup errors to 503", () => {
    const sql = fs.readFileSync(path.join(ROOT, "db/schema/008_practice_mcq.sql"), "utf8");
    expect(sql).toContain("question_type");
    expect(sql).toContain("correct_answer");
    expect(sql).toContain("MCQ");
    expect(sql).toContain("OPEN_ENDED");
    expect(isMissingPracticeMcqColumnError({ code: "PGRST204", message: "Could not find the 'question_type' column in the schema cache" })).toBe(true);
    expect(isMissingPracticeMcqColumnError(new Error('column "correct_answer" of relation "practice_questions" does not exist'))).toBe(true);
    expect(isMissingPracticeMcqColumnError(new Error("Project not found"))).toBe(false);
    expect(isMissingPracticeMcqColumnError(null)).toBe(false);
    expect(PRACTICE_MCQ_SETUP_MESSAGE).toContain("008_practice_mcq.sql");
  });

  it("practice routes map the setup error to 503 (not a bare 500)", () => {
    const files = [
      "app/api/projects/[projectId]/practice/route.ts",
      "app/api/projects/[projectId]/practice/[assignmentId]/route.ts",
      "app/api/projects/[projectId]/practice/[assignmentId]/submit/route.ts",
      "app/api/projects/[projectId]/practice/[assignmentId]/summary/route.ts",
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel} 503`).toContain("503");
      expect(src, `${rel} setup`).toContain("007_practice");
      expect(src, `${rel} mcq setup`).toContain("008_practice_mcq");
    }
  });

  it("sidebar exposes Practice in the project nav", () => {
    const src = fs.readFileSync(path.join(ROOT, "components/Sidebar.tsx"), "utf8");
    expect(src).toContain("PracticeIcon");
    expect(src).toContain("`${base}/practice`");
  });
});

describe("manual question counts (quiz + practice steppers)", () => {
  it("clamps practice counts to 1..8 with default 5", () => {
    expect(PRACTICE_MIN_COUNT).toBe(1);
    expect(PRACTICE_MAX_COUNT).toBe(8);
    expect(PRACTICE_DEFAULT_COUNT).toBe(5);
    expect(clampPracticeCount(undefined)).toBe(5);
    expect(clampPracticeCount(0)).toBe(1);
    expect(clampPracticeCount(3)).toBe(3);
    expect(clampPracticeCount(99)).toBe(8);
    expect(clampPracticeCount(4.9)).toBe(4);
    expect(clampPracticeCount(NaN)).toBe(5);
  });

  it("clamps quiz counts to 1..10 with default 10", () => {
    expect(QUIZ_MIN_COUNT).toBe(1);
    expect(QUIZ_MAX_COUNT).toBe(10);
    expect(QUIZ_DEFAULT_COUNT).toBe(10);
    expect(clampQuizCount(undefined)).toBe(10);
    expect(clampQuizCount(0)).toBe(1);
    expect(clampQuizCount(7)).toBe(7);
    expect(clampQuizCount(99)).toBe(10);
    expect(clampQuizCount(NaN)).toBe(10);
  });

  it("both clients send the chosen count to their generate endpoints", () => {
    const quiz = fs.readFileSync(path.join(ROOT, "app/(app)/projects/[projectId]/quiz/QuizClient.tsx"), "utf8");
    expect(quiz).toContain("clampQuizCount(quizCount)");
    expect(quiz).toContain("setQuizCount");
    const practice = fs.readFileSync(path.join(ROOT, "app/(app)/projects/[projectId]/practice/PracticeClient.tsx"), "utf8");
    expect(practice).toContain("clampPracticeCount(practiceCount)");
    expect(practice).toContain("setPracticeCount");
  });
});
