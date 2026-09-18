import { describe, it, expect } from "vitest";
import { buildAccuracyOverTime } from "@/services/analytics.service";

describe("buildAccuracyOverTime — honest per-day aggregation", () => {
  it("returns [] for no answers (page shows the empty state, never a chart)", () => {
    expect(buildAccuracyOverTime([])).toEqual([]);
  });

  it("groups answers by day, oldest first", () => {
    const rows = [
      { created_at: "2026-09-02T10:00:00Z", is_correct: true, score: 100 },
      { created_at: "2026-09-01T10:00:00Z", is_correct: false, score: 0 },
      { created_at: "2026-09-01T12:00:00Z", is_correct: true, score: 100 },
    ];
    const out = buildAccuracyOverTime(rows);
    expect(out.map((r) => r.date)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(out[0]).toMatchObject({ accuracy: 50, avgScore: 50, count: 2 });
    expect(out[1]).toMatchObject({ accuracy: 100, avgScore: 100, count: 1 });
  });

  it("keeps accuracy null when a day has only pending (ungraded) answers", () => {
    const rows = [{ created_at: "2026-09-03T10:00:00Z", is_correct: null, score: null }];
    const out = buildAccuracyOverTime(rows);
    expect(out).toHaveLength(1);
    expect(out[0].accuracy).toBeNull();
    expect(out[0].avgScore).toBeNull();
    expect(out[0].count).toBe(1);
  });

  it("mixes graded and pending answers without inventing data", () => {
    const rows = [
      { created_at: "2026-09-04T10:00:00Z", is_correct: true, score: 80 },
      { created_at: "2026-09-04T11:00:00Z", is_correct: null, score: null },
    ];
    const out = buildAccuracyOverTime(rows);
    expect(out[0]).toMatchObject({ accuracy: 100, avgScore: 80, count: 2 });
  });

  it("caps at the last 14 active days", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      created_at: `2026-08-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      is_correct: true as boolean | null,
      score: 100 as number | null,
    }));
    const out = buildAccuracyOverTime(rows);
    expect(out).toHaveLength(14);
    expect(out[0].date).toBe("2026-08-07");
    expect(out[13].date).toBe("2026-08-20");
  });
});
