import { describe, it, expect } from "vitest";
import { stripQuestionForTaking, gateQuestionForReview } from "@/services/quiz.service";

const FULL = {
  id: "q1",
  concept_id: "c1",
  type: "MCQ",
  difficulty: "medium",
  question: "What is 2+2?",
  options: ["3", "4", "5"],
  correct_answer: "4",
  explanation: "Basic addition.",
};

describe("stripQuestionForTaking — pre-submission GETs never leak answers", () => {
  it("removes correct_answer and explanation", () => {
    const q = stripQuestionForTaking(FULL);
    expect(q).not.toHaveProperty("correct_answer");
    expect(q).not.toHaveProperty("explanation");
  });

  it("keeps stem, options and identity, marks unanswered", () => {
    const q = stripQuestionForTaking(FULL);
    expect(q.id).toBe("q1");
    expect(q.question).toBe("What is 2+2?");
    expect(q.options).toEqual(["3", "4", "5"]);
    expect(q.answered).toBe(false);
  });

  it("is safe on already-stripped input (idempotent)", () => {
    const once = stripQuestionForTaking(FULL);
    const twice = stripQuestionForTaking(once);
    expect(twice).not.toHaveProperty("correct_answer");
    expect(twice.answered).toBe(false);
  });
});

describe("gateQuestionForReview — ?answers=1 discloses only answered rows", () => {
  it("keeps answer fields for answered questions", () => {
    const q = gateQuestionForReview(FULL, true);
    expect(q.answered).toBe(true);
    expect(q.correct_answer).toBe("4");
    expect(q.explanation).toBe("Basic addition.");
  });

  it("nulls answer fields for unanswered questions", () => {
    const q = gateQuestionForReview(FULL, false);
    expect(q.answered).toBe(false);
    expect(q.correct_answer).toBeNull();
    expect(q.explanation).toBeNull();
    // stem still visible for taking
    expect(q.question).toBe("What is 2+2?");
    expect(q.options).toEqual(["3", "4", "5"]);
  });
});
