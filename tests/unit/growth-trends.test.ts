import { describe, it, expect } from "vitest";
import {
  classifyTrend,
  summarizeHistoryTrend,
  TREND_THRESHOLD,
} from "@/services/growth.service";

describe("classifyTrend — fixed ±5 threshold (core learning rule)", () => {
  it("exposes the threshold", () => {
    expect(TREND_THRESHOLD).toBe(5);
  });

  it("needs a move strictly greater than 5 to count", () => {
    expect(classifyTrend(50, 55)).toBe("STABLE");
    expect(classifyTrend(50, 55.01)).toBe("IMPROVING");
    expect(classifyTrend(50, 45)).toBe("STABLE");
    expect(classifyTrend(50, 44.99)).toBe("REQUIRES_ATTENTION");
  });

  it("classifies clear moves", () => {
    expect(classifyTrend(40, 70)).toBe("IMPROVING");
    expect(classifyTrend(70, 40)).toBe("REQUIRES_ATTENTION");
    expect(classifyTrend(60, 61)).toBe("STABLE");
  });
});

describe("summarizeHistoryTrend — a trend needs two results", () => {
  it("returns no trend for zero history", () => {
    expect(summarizeHistoryTrend([])).toEqual({ trend: "STABLE", delta: null, previousScore: null });
  });

  it("returns no trend for a single result (first result is evidence, not a trend)", () => {
    // A first quiz of 0 → 30 must NOT read as "+30 IMPROVING".
    expect(summarizeHistoryTrend([{ previous_score: 0, new_score: 30 }])).toEqual({
      trend: "STABLE",
      delta: null,
      previousScore: null,
    });
  });

  it("compares new_score of the two most recent points", () => {
    const rows = [
      { previous_score: 30, new_score: 55 },
      { previous_score: 0, new_score: 30 },
    ];
    expect(summarizeHistoryTrend(rows)).toEqual({ trend: "IMPROVING", delta: 25, previousScore: 30 });
  });

  it("flags declines beyond the threshold", () => {
    const rows = [
      { previous_score: 55, new_score: 40 },
      { previous_score: 30, new_score: 55 },
    ];
    expect(summarizeHistoryTrend(rows)).toEqual({
      trend: "REQUIRES_ATTENTION",
      delta: -15,
      previousScore: 55,
    });
  });

  it("stays stable within the threshold and rounds to 2 decimals", () => {
    const rows = [
      { previous_score: 50, new_score: 53.333 },
      { previous_score: 48, new_score: 50 },
    ];
    const r = summarizeHistoryTrend(rows);
    expect(r.trend).toBe("STABLE");
    expect(r.delta).toBe(3.33);
    expect(r.previousScore).toBe(50);
  });

  it("accepts numeric strings from the NUMERIC columns", () => {
    const rows = [
      { previous_score: "30", new_score: "60" },
      { previous_score: "0", new_score: "30" },
    ];
    expect(summarizeHistoryTrend(rows).trend).toBe("IMPROVING");
  });

  it("ignores older rows beyond the latest two", () => {
    const rows = [
      { previous_score: 50, new_score: 52 },
      { previous_score: 48, new_score: 50 },
      { previous_score: 0, new_score: 10 }, // stale — must not affect the verdict
    ];
    const r = summarizeHistoryTrend(rows);
    expect(r).toEqual({ trend: "STABLE", delta: 2, previousScore: 50 });
  });
});
