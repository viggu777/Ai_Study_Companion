import { describe, it, expect } from "vitest";

import {
  compareEvalRuns,
  evalPassRatePct,
  formatEvalPassRate,
  makeEvalRunId,
  normalizeEvalRun,
  type EvalRun,
} from "@/services/evaluation.service";

function mkRun(over: Partial<EvalRun> & { results: EvalRun["results"] }): EvalRun {
  const flat = Object.values(over.results).flat();
  const totalTests = over.totalTests ?? flat.length;
  const passedTests = over.passedTests ?? flat.filter((c) => c.passed).length;
  return {
    runId: "eval-test",
    suiteVersion: "1",
    started: "2026-09-17T00:00:00.000Z",
    finished: "2026-09-17T00:00:01.000Z",
    totalTests,
    passedTests,
    failedTests: Math.max(0, totalTests - passedTests),
    passRate: `${passedTests}/${totalTests}`,
    ...over,
  };
}

const C = (id: string, passed: boolean) => ({ id, passed, details: id });

describe("evaluation run tracking — normalize", () => {
  it("normalizes the current phase-16 results shape", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const raw = JSON.parse(fs.readFileSync(path.resolve("evaluation-results.json"), "utf-8"));
    const run = normalizeEvalRun(raw);
    expect(run).not.toBeNull();
    expect(run!.totalTests).toBe(18);
    expect(run!.passedTests).toBe(18);
    expect(run!.results.tutor.length).toBeGreaterThan(0);
  });

  it("returns null for malformed input without throwing", () => {
    expect(normalizeEvalRun(null)).toBeNull();
    expect(normalizeEvalRun(undefined)).toBeNull();
    expect(normalizeEvalRun("not json")).toBeNull();
    expect(normalizeEvalRun(42)).toBeNull();
    expect(normalizeEvalRun({})).toBeNull();
    expect(normalizeEvalRun({ results: { tutor: "nope" } })).toBeNull();
    expect(normalizeEvalRun({ bogus: true })).toBeNull();
  });

  it("normalizes legacy array shapes", () => {
    const run = normalizeEvalRun([{ id: "A", passed: true }, { id: "B", passed: false }]);
    expect(run).not.toBeNull();
    expect(run!.totalTests).toBe(2);
    expect(run!.passedTests).toBe(1);
  });

  it("computes totals when missing", () => {
    const run = normalizeEvalRun({ results: { tutor: [C("T1", true), C("T2", false)] } });
    expect(run!.totalTests).toBe(2);
    expect(run!.failedTests).toBe(1);
  });
});

describe("evaluation run tracking — comparison", () => {
  it("baseline when there is no previous run", () => {
    const cur = mkRun({ results: { tutor: [C("T1", true)] } });
    const cmp = compareEvalRuns(cur, null);
    expect(cmp.status).toBe("BASELINE");
    expect(cmp.previousPassRatePct).toBeNull();
    expect(cmp.passRateDeltaPp).toBeNull();
  });

  it("detects UNCHANGED on identical runs", () => {
    const a = mkRun({ results: { tutor: [C("T1", true), C("T2", true)] } });
    const b = mkRun({ results: { tutor: [C("T1", true), C("T2", true)] } });
    const cmp = compareEvalRuns(b, a);
    expect(cmp.status).toBe("UNCHANGED");
    expect(cmp.newlyFailed).toEqual([]);
  });

  it("detects REGRESSED on pass-rate drop with case detail", () => {
    const prev = mkRun({ results: { tutor: [C("T1", true), C("T2", true)] } });
    const cur = mkRun({ results: { tutor: [C("T1", true), C("T2", false)] } });
    const cmp = compareEvalRuns(cur, prev);
    expect(cmp.status).toBe("REGRESSED");
    expect(cmp.newlyFailed).toEqual(["tutor:T2"]);
    expect(cmp.passRateDeltaPp).toBeLessThan(0);
  });

  it("detects IMPROVED on pass-rate gain", () => {
    const prev = mkRun({ results: { tutor: [C("T1", false)] } });
    const cur = mkRun({ results: { tutor: [C("T1", true)] } });
    const cmp = compareEvalRuns(cur, prev);
    expect(cmp.status).toBe("IMPROVED");
    expect(cmp.newlyPassed).toEqual(["tutor:T1"]);
  });

  it("flags REGRESSED when a case breaks but the rate ties", () => {
    const prev = mkRun({ results: { tutor: [C("T1", true), C("T2", false)] } });
    const cur = mkRun({ results: { tutor: [C("T1", false), C("T2", true)] } });
    const cmp = compareEvalRuns(cur, prev);
    expect(cmp.status).toBe("REGRESSED");
    expect(cmp.newlyFailed).toEqual(["tutor:T1"]);
  });

  it("malformed previous run never crashes comparison", () => {
    const cur = mkRun({ results: { tutor: [C("T1", true)] } });
    const prev = normalizeEvalRun({ garbage: true });
    const cmp = compareEvalRuns(cur, prev);
    expect(cmp.status).toBe("BASELINE");
  });
});

describe("evaluation run tracking — formatting", () => {
  it("formats pass rate numerically", () => {
    const run = mkRun({ results: { tutor: [C("T1", true), C("T2", false)] } });
    expect(evalPassRatePct(run)).toBe(50);
    expect(formatEvalPassRate(run)).toBe("1/2 (50.0%)");
  });

  it("generates filesystem-safe run ids", () => {
    const id = makeEvalRunId(new Date("2026-09-17T16:28:09.000Z"), "abc123");
    expect(id).toBe("eval-20260917-162809-abc123");
    expect(id).toMatch(/^[a-z0-9-]+$/);
  });
});
