import { requireAdmin } from "@/lib/auth/admin";
import fs from "fs";
import path from "path";
import {
  compareEvalRuns,
  formatEvalPassRate,
  normalizeEvalRun,
  type EvalComparison,
  type EvalRun,
} from "@/services/evaluation.service";

export const dynamic = "force-dynamic";

interface EvalRow {
  suite?: string;
  case?: string;
  name?: string;
  id?: string;
  input?: string;
  expected?: string;
  actual?: string;
  details?: string;
  output?: string;
  passed?: boolean;
  pass?: boolean;
  result?: string;
  [k: string]: unknown;
}

function readJsonFile(p: string): { parsed: unknown; error?: string } {
  try {
    return { parsed: JSON.parse(fs.readFileSync(p, "utf-8")) };
  } catch (e) {
    return { parsed: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function loadEvaluationRuns(): {
  current: EvalRun | null;
  previous: EvalRun | null;
  rows: EvalRow[];
  source: string;
  historyCount: number;
  error?: string;
} {
  const candidates = [
    path.join(process.cwd(), "evaluation-results.json"),
    path.join(process.cwd(), "tests", "eval", "results.json"),
    path.join(process.cwd(), "docs", "evaluation.json"),
    path.join(process.cwd(), "data", "evaluations.json"),
  ];
  let source = candidates.join(", ");
  let current: EvalRun | null = null;
  let error: string | undefined;

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const { parsed, error: parseError } = readJsonFile(p);
      if (parseError) {
        error = `Failed to parse ${p}: ${parseError}`;
        source = p;
        continue;
      }
      const run = normalizeEvalRun(parsed, path.basename(p));
      if (run) {
        current = run;
        source = p;
        error = undefined;
        break;
      }
      error = `Unrecognized evaluation shape in ${p}`;
      source = p;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      source = p;
    }
  }

  // History: per-run files written by tests/eval/run-eval.ts (never invented).
  let previous: EvalRun | null = null;
  let historyCount = 0;
  try {
    const historyDir = path.join(process.cwd(), "tests", "eval", "history");
    if (fs.existsSync(historyDir)) {
      const files = fs.readdirSync(historyDir).filter((f) => f.endsWith(".json")).sort();
      historyCount = files.length;
      const runs: EvalRun[] = [];
      for (const f of files) {
        const { parsed } = readJsonFile(path.join(historyDir, f));
        const run = normalizeEvalRun(parsed, f.replace(/\.json$/, ""));
        if (run) runs.push(run);
      }
      runs.sort((a, b) => (b.finished ?? b.started ?? "").localeCompare(a.finished ?? a.started ?? ""));
      previous = runs.find((r) => r.runId !== current?.runId) ?? null;
      // If current has no runId (legacy file), the newest history entry is still
      // a valid previous run — keep it.
    }
  } catch (e) {
    // History is optional — Admin still renders the latest run as baseline.
    console.error("Eval history load failed:", e instanceof Error ? e.message : String(e));
  }

  let rows: EvalRow[] = [];
  if (current) {
    rows = Object.entries(current.results).flatMap(([suite, cases]) =>
      cases.map((r) => ({ suite, ...r }) as unknown as EvalRow)
    );
  }
  return { current, previous, rows, source, historyCount, error };
}

function StatusBadge({ status }: { status: EvalComparison["status"] }) {
  const tone =
    status === "IMPROVED"
      ? "bg-green-100 text-green-800"
      : status === "REGRESSED"
        ? "bg-red-100 text-red-800"
        : status === "UNCHANGED"
          ? "bg-stone-100 text-stone-700"
          : "bg-sky-100 text-sky-800";
  return (
    <span className={`inline-flex px-2.5 py-1 rounded text-xs font-semibold ${tone}`}>{status}</span>
  );
}

export default async function AdminAiEvaluationPage() {
  await requireAdmin();

  const { current, previous, rows, source, historyCount, error } = loadEvaluationRuns();

  // Also try to read docs/evaluation.md excerpt if no JSON
  let mdExcerpt: string | null = null;
  try {
    const mdPath = path.join(process.cwd(), "docs", "evaluation.md");
    if (fs.existsSync(mdPath) && !current) {
      const md = fs.readFileSync(mdPath, "utf-8");
      mdExcerpt = md.slice(0, 4000);
    }
  } catch {}

  const comparison = current ? compareEvalRuns(current, previous) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">AI Evaluation</h1>
        <p className="text-sm text-stone-500 mt-1">
          Curated evaluation fixtures with run-over-run regression tracking. Reads the latest run from{" "}
          <code className="bg-stone-100 px-1 rounded text-xs">evaluation-results.json</code> and compares
          against <code className="bg-stone-100 px-1 rounded text-xs">tests/eval/history/</code>. Re-run with{" "}
          <code className="bg-stone-100 px-1 rounded text-xs">npm run eval</code>.
        </p>
        <p className="text-xs text-stone-400 mt-1">Source: {source}{historyCount > 0 ? ` · ${historyCount} historical run(s)` : ""}</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">Failed to load evaluation results: {error}</div>}

      {!current ? (
        <div className="bg-white border border-stone-200 rounded-lg p-8">
          <h2 className="text-sm font-semibold text-stone-900 mb-2">No evaluation results yet</h2>
          <p className="text-sm text-stone-600">
            Run <code className="bg-stone-100 px-1 rounded">npm run eval</code> to write{" "}
            <code className="bg-stone-100 px-1 rounded">evaluation-results.json</code> and{" "}
            <code className="bg-stone-100 px-1 rounded">tests/eval/results.json</code>. This page renders the
            latest run plus a run-over-run comparison once two or more runs exist.
          </p>
          <p className="text-sm text-stone-600 mt-3">
            Expected suites per architecture.md §15: Tutor (grounded / unsupported / multi-concept / citation correctness / prompt-injection), Retrieval (3–5 queries), Assessment (2–3 open-ended answers), Recommendation (2 weak-concept scenarios).
          </p>
          {mdExcerpt ? (
            <div className="mt-6">
              <h3 className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">docs/evaluation.md excerpt</h3>
              <pre className="bg-stone-50 border border-stone-200 rounded-lg p-4 text-xs text-stone-700 whitespace-pre-wrap overflow-auto max-h-96">{mdExcerpt}</pre>
            </div>
          ) : (
            <p className="text-xs text-stone-400 mt-4">No docs/evaluation.md excerpt available.</p>
          )}
        </div>
      ) : (
        <>
          {/* Run metadata + comparison */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
              <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Current run</div>
              <div className="text-sm font-semibold text-stone-900 mt-1 break-all">{current.runId ?? "legacy run (no id)"}</div>
              <div className="text-xs text-stone-400 mt-1">
                {(current.finished ?? current.started ?? "unknown time") +
                  (current.suiteVersion ? ` · suite v${current.suiteVersion}` : "")}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
              <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Pass rate</div>
              <div className="text-3xl font-bold text-stone-900 mt-1">{formatEvalPassRate(current)}</div>
              <div className="text-xs text-stone-400 mt-1">
                total {current.totalTests} · passed {current.passedTests} · failed {current.failedTests}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
              <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">vs previous run</div>
              <div className="mt-2">{comparison && <StatusBadge status={comparison.status} />}</div>
              <div className="text-xs text-stone-400 mt-1">
                {comparison?.status === "BASELINE"
                  ? "This is the baseline — run eval again to compare."
                  : `previous ${previous?.runId ?? "—"} · ${comparison?.previousPassRatePct?.toFixed(1) ?? "?"}% → ${comparison?.currentPassRatePct.toFixed(1)}% (${
                      (comparison?.passRateDeltaPp ?? 0) >= 0 ? "+" : ""
                    }${comparison?.passRateDeltaPp?.toFixed(1) ?? "?"} pp)`}
              </div>
            </div>
          </div>

          {comparison && comparison.status !== "BASELINE" && (
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
              <h2 className="text-sm font-semibold text-stone-900">Case-level changes</h2>
              {comparison.newlyFailed.length === 0 && comparison.newlyPassed.length === 0 ? (
                <p className="text-sm text-stone-500 mt-1">No individual case flipped between runs.</p>
              ) : (
                <div className="mt-2 space-y-2 text-sm">
                  {comparison.newlyFailed.length > 0 && (
                    <p className="text-red-700">
                      Newly failed ({comparison.newlyFailed.length}):{" "}
                      <span className="font-mono text-xs">{comparison.newlyFailed.join(", ")}</span>
                    </p>
                  )}
                  {comparison.newlyPassed.length > 0 && (
                    <p className="text-green-700">
                      Newly passed ({comparison.newlyPassed.length}):{" "}
                      <span className="font-mono text-xs">{comparison.newlyPassed.join(", ")}</span>
                    </p>
                  )}
                </div>
              )}
              {!comparison.totalsEqual && (
                <p className="text-xs text-stone-400 mt-2">Note: total case counts differ between runs (suite evolution) — pass-rate comparison accounts for this.</p>
              )}
            </div>
          )}

          <div className="bg-white rounded-lg shadow-card border border-stone-200 overflow-hidden">
            <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 border-b">
              Showing {rows.length} evaluation rows from <code className="bg-white px-1 rounded border">{source}</code>
            </div>
            {rows.length === 0 ? (
              <p className="p-6 text-sm text-stone-500">
                This run contains no cases — re-run with <code className="bg-stone-100 px-1 rounded">npm run eval</code> to regenerate fixtures.
              </p>
            ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Suite</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Case</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Result</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {rows.map((r, i) => {
                    const suite = (r.suite as string) ?? "—";
                    const c = (r.case as string) ?? (r.name as string) ?? (r.id as string) ?? `row ${i + 1}`;
                    const passed = r.passed ?? r.pass ?? (String(r.result ?? "").toLowerCase() === "pass");
                    const details = r.details ?? r.actual ?? r.output ?? r.expected ?? JSON.stringify(r).slice(0, 200);
                    return (
                      <tr key={`${suite}-${c}-${i}`} className="hover:bg-stone-50">
                        <td className="px-3 py-1.5 text-stone-900">{suite}</td>
                        <td className="px-3 py-1.5 text-stone-700">{c}</td>
                        <td className="px-3 py-1.5">
                          {passed === true ? (
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">pass</span>
                          ) : passed === false ? (
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">fail</span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-stone-100 text-stone-700">{String(r.result ?? "—")}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-stone-600 max-w-md truncate" title={typeof details === "string" ? details : JSON.stringify(details)}>
                          {typeof details === "string" ? details.slice(0, 120) : JSON.stringify(details).slice(0, 120)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
