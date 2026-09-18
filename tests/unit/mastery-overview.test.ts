import { describe, it, expect } from "vitest";
import {
  computeNewMastery,
  computeNewMasteryWeighted,
  flashcardEvidenceFor,
  masteryLevelFor,
  MASTERY_WEIGHTS,
  FLASHCARD_EVIDENCE,
} from "@/services/mastery.service";

describe("mastery weights — quiz/practice strong, flashcards gentle", () => {
  it("keeps legacy quiz formula (0.7/0.3)", () => {
    expect(computeNewMastery(0, 100)).toBe(30);
    expect(computeNewMastery(50, 50)).toBe(50);
    expect(MASTERY_WEIGHTS.QUIZ).toBe(0.3);
    expect(MASTERY_WEIGHTS.PRACTICE).toBe(0.3);
  });

  it("flashcard weight nudges instead of jumping", () => {
    expect(MASTERY_WEIGHTS.FLASHCARD).toBe(0.15);
    // Same evidence moves mastery half as far via flashcards
    expect(computeNewMasteryWeighted(0, 85, MASTERY_WEIGHTS.FLASHCARD)).toBe(12.75);
    expect(computeNewMasteryWeighted(0, 85, MASTERY_WEIGHTS.QUIZ)).toBe(25.5);
    // Repeated Got-it converges upward but slowly
    let m = 0;
    for (let i = 0; i < 5; i++) m = computeNewMasteryWeighted(m, 85, MASTERY_WEIGHTS.FLASHCARD);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(50);
  });

  it("clamps + rounds weighted formula", () => {
    expect(computeNewMasteryWeighted(150, 150, 0.3)).toBe(100);
    expect(computeNewMasteryWeighted(-100, -100, 0.15)).toBe(0);
    expect(computeNewMasteryWeighted(33.333, 66.666, 0.3)).toBe(43.33);
  });
});

describe("flashcard evidence mapping", () => {
  it("maps known/learning to fixed scores", () => {
    expect(flashcardEvidenceFor("known")).toBe(85);
    expect(flashcardEvidenceFor("learning")).toBe(20);
    expect(FLASHCARD_EVIDENCE.KNOWN).toBe(85);
    expect(FLASHCARD_EVIDENCE.LEARNING).toBe(20);
  });

  it("known can never perfect-score via flashcards alone", () => {
    // Even from 90, one Got-it stays below 90 (gentle weight)
    const once = computeNewMasteryWeighted(90, flashcardEvidenceFor("known"), MASTERY_WEIGHTS.FLASHCARD);
    expect(once).toBeLessThan(90);
    // Still-learning drags down
    expect(computeNewMasteryWeighted(80, flashcardEvidenceFor("learning"), MASTERY_WEIGHTS.FLASHCARD)).toBeLessThan(80);
  });
});

describe("masteryLevelFor — 5-level Khan-style bands", () => {
  it("classifies null as UNTESTED", () => {
    expect(masteryLevelFor(null)).toBe("UNTESTED");
  });
  it("bands: emerging <35, developing <70, proficient <90, mastered >=90", () => {
    expect(masteryLevelFor(0)).toBe("EMERGING");
    expect(masteryLevelFor(34.9)).toBe("EMERGING");
    expect(masteryLevelFor(35)).toBe("DEVELOPING");
    expect(masteryLevelFor(69.9)).toBe("DEVELOPING");
    expect(masteryLevelFor(70)).toBe("PROFICIENT");
    expect(masteryLevelFor(89.9)).toBe("PROFICIENT");
    expect(masteryLevelFor(90)).toBe("MASTERED");
    expect(masteryLevelFor(100)).toBe("MASTERED");
  });
});
