import { describe, it, expect } from "vitest";
import { computeNewMastery } from "@/services/mastery.service";

describe("computeNewMastery — deterministic formula new = prev*0.7 + evidence*0.3", () => {
  const cases: Array<[number, number, number, string]> = [
    [0, 0, 0, "both zero stays zero"],
    [0, 100, 30, "no prior, perfect evidence => 30"],
    [50, 50, 50, "mid stays mid"],
    [80, 20, 62, "80*0.7=56 + 6 => 62"],
    [100, 0, 70, "perfect prior collapses to 70 with zero evidence"],
    [100, 100, 100, "perfect stays perfect (clamped)"],
    [0, 0, 0, "zero floor"],
    [90, 120, 99, "evidence capped at 100? actually 90*0.7=63 +36=99 -> still <100"],
    [90, 100, 93, "90*0.7=63 +30=93"],
    [33.333, 66.666, 43.33, "rounded to 2 decimals: 23.3331+20 =>43.3331=>43.33"],
    [0, 50, 15, "0 + 15"],
    [70, 60, 67, "70*0.7=49 +18=67"],
    [20, 80, 38, "20*0.7=14+24=38"],
    [95, 95, 95, "stable high"],
    [10, 10, 10, "stable low"],
  ];

  it.each(cases)("prev=%i evidence=%i => expected %i (%s)", (prev, evidence, expected) => {
    expect(computeNewMastery(prev, evidence)).toBe(expected);
  });

  it("clamps below 0 and above 100", () => {
    // negative previous or evidence beyond range should clamp
    expect(computeNewMastery(-10, 50)).toBeGreaterThanOrEqual(0);
    expect(computeNewMastery(150, 150)).toBe(100);
    expect(computeNewMastery(-100, -100)).toBe(0);
  });

  it("rounds to 2 decimals", () => {
    const v = computeNewMastery(33.333, 66.666);
    // Should be exactly 43.33 not 43.3331
    expect(v).toBe(43.33);
    expect(v.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it("is pure — does not mutate inputs and returns number", () => {
    const a = 42;
    const b = 73;
    const r = computeNewMastery(a, b);
    expect(typeof r).toBe("number");
    expect(a).toBe(42);
    expect(b).toBe(73);
  });
});

describe("mastery aggregation — quiz evidence averaging", () => {
  // Spec: multiple questions touching same concept => average per concept
  function aggregateScores(scores: number[]): number {
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  it("averages MCQ 100/0 correctly", () => {
    // MCQ correctness as 0/100
    expect(aggregateScores([100, 0])).toBe(50);
    expect(computeNewMastery(50, aggregateScores([100, 0]))).toBe(50);
  });

  it("averages open-ended scores", () => {
    expect(aggregateScores([80, 70])).toBe(75);
    expect(computeNewMastery(40, 75)).toBe(50.5);
  });

  it("single evidence passthrough", () => {
    expect(aggregateScores([100])).toBe(100);
    expect(computeNewMastery(0, 100)).toBe(30);
  });
});
