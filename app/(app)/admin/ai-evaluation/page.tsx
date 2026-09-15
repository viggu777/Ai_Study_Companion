import { requireAdmin } from "@/lib/auth/admin";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

interface EvalRow {
  suite?: string;
  case?: string;
  name?: string;
  input?: string;
  expected?: string;
  actual?: string;
  output?: string;
  passed?: boolean;
  pass?: boolean;
  result?: string;
  [k: string]: unknown;
}

function loadEvaluationResults(): { rows: EvalRow[]; source: string; error?: string } {
  // Potential sources the phase 16 eval script may write to
  const candidates = [
    path.join(process.cwd(), "evaluation-results.json"),
    path.join(process.cwd(), "tests", "eval", "results.json"),
    path.join(process.cwd(), "docs", "evaluation.json"),
    path.join(process.cwd(), "data", "evaluations.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        let rows: EvalRow[];
        if (Array.isArray(parsed)) rows = parsed;
        else if (Array.isArray(parsed.results)) rows = parsed.results;
        else if (Array.isArray(parsed.rows)) rows = parsed.rows;
        else if (parsed.results && typeof parsed.results === "object" && !Array.isArray(parsed.results)) {
          // Phase 16 shape: { results: { tutor:[], retrieval:[], assessment:[], recommendation:[] }, totalTests, passRate ... }
          rows = Object.entries(parsed.results as Record<string, unknown[]>).flatMap(([suite, cases]) =>
            (cases as EvalRow[]).map((r) => ({ suite, ...r } as EvalRow))
          );
          // Prepend summary row for passRate visibility
          if (parsed.passRate || parsed.totalTests) {
            rows.unshift({
              suite: "summary",
              case: `Phase 16 eval ${parsed.passRate ?? ""} (${parsed.passedTests ?? "?"}/${parsed.totalTests ?? "?"})`,
              passed: (parsed.failedTests ?? 1) === 0,
              actual: `finished ${parsed.finished ?? ""} total ${parsed.totalTests} passed ${parsed.passedTests}`,
            } as EvalRow);
          }
        } else rows = [parsed];
        return { rows, source: p };
      }
    } catch (e) {
      return { rows: [], source: p, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { rows: [], source: candidates.join(", ") };
}

export default async function AdminAiEvaluationPage() {
  await requireAdmin();

  const { rows, source, error } = loadEvaluationResults();

  // Also try to read docs/evaluation.md excerpt if no JSON
  let mdExcerpt: string | null = null;
  try {
    const mdPath = path.join(process.cwd(), "docs", "evaluation.md");
    if (fs.existsSync(mdPath) && rows.length === 0) {
      const md = fs.readFileSync(mdPath, "utf-8");
      mdExcerpt = md.slice(0, 4000);
    }
  } catch {}

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">AI Evaluation</h1>
        <p className="text-sm text-stone-500 mt-1">
          Surfaces results from phase 16 evaluation fixtures. Reads from JSON source written by the eval script (e.g. <code className="bg-stone-100 px-1 rounded text-xs">evaluation-results.json</code>). Phase 16 not yet run → table will be empty.
        </p>
        <p className="text-xs text-stone-400 mt-1">Probed sources: {source}</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">Failed to parse evaluation JSON: {error}</div>}

      {rows.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-lg p-8">
          <h2 className="text-sm font-semibold text-stone-900 mb-2">No evaluation results yet</h2>
          <p className="text-sm text-stone-600">
            Phase 16 will write a JSON file (e.g. <code className="bg-stone-100 px-1 rounded">evaluation-results.json</code> or <code className="bg-stone-100 px-1 rounded">tests/eval/results.json</code>) with an array of rows like{" "}
            <code className="bg-stone-100 px-1 rounded text-xs">{"{suite, case, passed, input, expected, actual}"}</code>. This page reads that file via <code className="bg-stone-100 px-1 rounded">fs.readFileSync</code> and renders it here.
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
            <p className="text-xs text-stone-400 mt-4">No docs/evaluation.md found yet — phase 16 will create docs/evaluation.md with actual recorded outputs.</p>
          )}
          <p className="text-xs text-stone-400 mt-4">
            Verification: after phase 16, re-run the eval script against the live system and refresh this page; rows should appear with pass/fail per case.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-card border border-stone-200 overflow-hidden">
          <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 border-b">
            Showing {rows.length} evaluation rows from <code className="bg-white px-1 rounded border">{source}</code>
          </div>
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
                  const suite = (r.suite as string) ?? (r["suite"] as string) ?? "—";
                  const c = (r.case as string) ?? (r.name as string) ?? `row ${i + 1}`;
                  const passed = r.passed ?? r.pass ?? (String(r.result ?? "").toLowerCase() === "pass");
                  const details = r.actual ?? r.output ?? r.expected ?? JSON.stringify(r).slice(0, 200);
                  return (
                    <tr key={i} className="hover:bg-stone-50">
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
        </div>
      )}
    </div>
  );
}
