/**
 * Evaluation run tracking (Task 4) — lightweight, file-based.
 *
 * The eval runner (`tests/eval/run-eval.ts`) writes one JSON file per run.
 * This service provides the pure logic the Admin AI Evaluation page uses:
 * normalize tolerant parsing (malformed output never crashes Admin),
 * run summaries, and current-vs-previous comparison
 * (IMPROVED / REGRESSED / UNCHANGED / BASELINE).
 *
 * No LLM-as-judge, no invented history: with no previous run the result is
 * explicitly BASELINE.
 */

export const EVAL_SUITE_VERSION = "1";

export type EvalComparisonStatus = "BASELINE" | "IMPROVED" | "REGRESSED" | "UNCHANGED";

export interface EvalCaseResult {
  id: string;
  passed: boolean;
  details?: string;
  [k: string]: unknown;
}

export interface EvalRun {
  runId: string | null;
  suiteVersion: string | null;
  started: string | null;
  finished: string | null;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  /** Legacy "18/18" string kept for backwards compatibility. */
  passRate: string;
  results: Record<string, EvalCaseResult[]>;
}

export interface EvalComparison {
  status: EvalComparisonStatus;
  currentPassRatePct: number;
  previousPassRatePct: number | null;
  /** Percentage-point delta (current - previous), null for baseline. */
  passRateDeltaPp: number | null;
  newlyFailed: string[];
  newlyPassed: string[];
  totalsEqual: boolean;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function toCaseArray(v: unknown, suite: string): EvalCaseResult[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((c, i) => {
      const r = asRecord(c);
      if (!r) return null;
      const id = typeof r.id === "string" && r.id.trim() ? r.id : `${suite}-row-${i + 1}`;
      return { ...r, id, passed: r.passed === true } as EvalCaseResult;
    })
    .filter((c): c is EvalCaseResult => c !== null);
}

/**
 * Normalize any known eval JSON shape into an EvalRun.
 * Returns null for malformed input (caller shows "no valid results").
 * Never throws.
 */
export function normalizeEvalRun(parsed: unknown, fallbackRunId: string | null = null): EvalRun | null {
  try {
    if (parsed === null || parsed === undefined) return null;
    if (Array.isArray(parsed)) {
      const cases = toCaseArray(parsed, "general");
      if (cases.length === 0) return null;
      return finalizeRun({ results: { general: cases } }, fallbackRunId);
    }
    const obj = asRecord(parsed);
    if (!obj) return null;

    // Phase-16 shape: { results: { tutor: [], ... }, totalTests, ... }
    if (obj.results && typeof obj.results === "object" && !Array.isArray(obj.results)) {
      const suites = obj.results as Record<string, unknown>;
      const results: Record<string, EvalCaseResult[]> = {};
      for (const [suite, cases] of Object.entries(suites)) {
        results[suite] = toCaseArray(cases, suite);
      }
      const totalCases = Object.values(results).flat().length;
      if (totalCases === 0) return null;
      return finalizeRun({ ...obj, results }, fallbackRunId);
    }
    // Flat shapes: { results: [...] } or { rows: [...] }
    if (Array.isArray(obj.results) || Array.isArray(obj.rows)) {
      const cases = toCaseArray(Array.isArray(obj.results) ? obj.results : obj.rows, "general");
      if (cases.length === 0) return null;
      return finalizeRun({ ...obj, results: { general: cases } }, fallbackRunId);
    }
    return null;
  } catch {
    return null;
  }
}

function finalizeRun(obj: Record<string, unknown>, fallbackRunId: string | null): EvalRun {
  const results = obj.results as Record<string, EvalCaseResult[]>;
  const flat = Object.values(results).flat();
  const totalTests = typeof obj.totalTests === "number" ? obj.totalTests : flat.length;
  const passedTests = typeof obj.passedTests === "number" ? obj.passedTests : flat.filter((c) => c.passed).length;
  const failedTests =
    typeof obj.failedTests === "number" ? obj.failedTests : Math.max(0, totalTests - passedTests);
  const passRate = typeof obj.passRate === "string" ? obj.passRate : `${passedTests}/${totalTests}`;
  const finished = typeof obj.finished === "string" ? obj.finished : null;
  const started = typeof obj.started === "string" ? obj.started : null;
  return {
    runId:
      typeof obj.runId === "string" && obj.runId.trim()
        ? obj.runId
        : typeof obj.run_id === "string" && (obj.run_id as string).trim()
          ? (obj.run_id as string)
          : fallbackRunId,
    suiteVersion: typeof obj.suiteVersion === "string" ? obj.suiteVersion : null,
    started,
    finished,
    totalTests,
    passedTests,
    failedTests,
    passRate,
    results,
  };
}

/** Case key is suite-qualified so identical ids in different suites don't collide. */
export function evalCaseKey(suite: string, id: string): string {
  return `${suite}:${id}`;
}

export function flattenEvalCases(run: EvalRun): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const [suite, cases] of Object.entries(run.results)) {
    for (const c of cases) map.set(evalCaseKey(suite, c.id), c.passed === true);
  }
  return map;
}

export function evalPassRatePct(run: EvalRun): number {
  if (run.totalTests <= 0) return 0;
  return (run.passedTests / run.totalTests) * 100;
}

/**
 * Compare two runs. Pass-rate drives the headline status; case-level flips
 * break ties so a same-rate run that broke a case still reads REGRESSED.
 */
export function compareEvalRuns(current: EvalRun, previous: EvalRun | null): EvalComparison {
  const currentPassRatePct = evalPassRatePct(current);
  if (!previous) {
    return {
      status: "BASELINE",
      currentPassRatePct,
      previousPassRatePct: null,
      passRateDeltaPp: null,
      newlyFailed: [],
      newlyPassed: [],
      totalsEqual: true,
    };
  }
  const previousPassRatePct = evalPassRatePct(previous);
  const prevMap = flattenEvalCases(previous);
  const curMap = flattenEvalCases(current);
  const newlyFailed: string[] = [];
  const newlyPassed: string[] = [];
  for (const [key, curPassed] of curMap) {
    if (!prevMap.has(key)) continue; // new case — not a regression signal
    const prevPassed = prevMap.get(key);
    if (prevPassed && !curPassed) newlyFailed.push(key);
    if (!prevPassed && curPassed) newlyPassed.push(key);
  }
  // Removed cases are ignored (suite evolution), not regressions.
  const totalsEqual = current.totalTests === previous.totalTests;
  let status: EvalComparisonStatus;
  if (currentPassRatePct > previousPassRatePct) status = "IMPROVED";
  else if (currentPassRatePct < previousPassRatePct) status = "REGRESSED";
  else if (newlyFailed.length > 0) status = "REGRESSED";
  else if (newlyFailed.length === 0 && newlyPassed.length === 0) status = "UNCHANGED";
  else status = "UNCHANGED";
  return {
    status,
    currentPassRatePct,
    previousPassRatePct,
    passRateDeltaPp: currentPassRatePct - previousPassRatePct,
    newlyFailed: newlyFailed.sort(),
    newlyPassed: newlyPassed.sort(),
    totalsEqual,
  };
}

/** "18/18 (100.0%)" — numeric form alongside the legacy "18/18" string. */
export function formatEvalPassRate(run: EvalRun): string {
  return `${run.passedTests}/${run.totalTests} (${evalPassRatePct(run).toFixed(1)}%)`;
}

/** Filesystem-safe run id: eval-YYYYMMDD-HHmmss-<rand6>. */
export function makeEvalRunId(at: Date = new Date(), randSuffix?: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`;
  const rand =
    randSuffix ?? Math.random().toString(36).slice(2, 8).padEnd(6, "0").slice(0, 6);
  return `eval-${stamp}-${rand}`;
}
