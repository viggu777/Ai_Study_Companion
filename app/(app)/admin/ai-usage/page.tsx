import { requireAdmin } from "@/lib/auth/admin";
import { getAdminAiUsage } from "@/services/admin.service";

export const dynamic = "force-dynamic";

export default async function AdminAiUsagePage() {
  await requireAdmin();

  let usage: Awaited<ReturnType<typeof getAdminAiUsage>> | null = null;
  let error: string | null = null;
  try {
    usage = await getAdminAiUsage();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">AI Usage</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  if (!usage) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">AI Usage</h1>
        <p className="text-sm text-stone-500 mt-1">
          Aggregated ai_operations — calls, latency, errors, tokens, cost per feature. Full table scans via service role (limit 1000, order by created_at desc).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Total calls</div>
          <div className="text-3xl font-bold text-stone-900 mt-1">{usage.totalCalls}</div>
          <div className="text-xs text-stone-400 mt-1">ai_operations count</div>
        </div>
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Tokens in / out</div>
          <div className="text-3xl font-bold text-stone-900 mt-1">
            {usage.totalTokensIn !== null ? usage.totalTokensIn.toLocaleString() : "—"}
            <span className="text-lg text-stone-400"> / </span>
            {usage.totalTokensOut !== null ? usage.totalTokensOut.toLocaleString() : "—"}
          </div>
          <div className="text-xs text-stone-400 mt-1">sum(tokens_in) / sum(tokens_out)</div>
        </div>
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Est. cost</div>
          <div className="text-3xl font-bold text-stone-900 mt-1">{usage.totalCost !== null ? `$${usage.totalCost.toFixed(4)}` : "—"}</div>
          <div className="text-xs text-stone-400 mt-1">sum(estimated_cost){usage.pricedCalls > 0 ? ` over ${usage.pricedCalls} priced calls` : ""}</div>
        </div>
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Error rate</div>
          <div className="text-3xl font-bold text-stone-900 mt-1">{usage.errorRate !== null ? `${(usage.errorRate * 100).toFixed(2)}%` : "—"}</div>
          <div className="text-xs text-stone-400 mt-1">fails / total · avg latency {usage.avgLatencyMs !== null ? `${usage.avgLatencyMs}ms` : "—"}</div>
        </div>
      </div>

      {(usage.totalTokensIn === null || usage.totalCost === null) && usage.totalCalls > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          Token/cost columns are empty because rows written before the usage-threading fix carry NULL tokens_in/out and estimated_cost.
          New Tutor, quiz, and embedding calls populate them — trigger one Tutor question and one quiz generation, then reload.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">Calls per feature</h2>
          {Object.keys(usage.perFeature).length === 0 ? (
            <p className="text-sm text-stone-500">No AI calls yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Feature</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Calls</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Tokens in</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Tokens out</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Est. cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {Object.entries(usage.perFeature)
                    .sort(([, a], [, b]) => b - a)
                    .map(([feat, cnt]) => {
                      const t = usage.tokensPerFeature[feat];
                      return (
                        <tr key={feat} className="hover:bg-stone-50">
                          <td className="px-3 py-1.5 font-medium text-stone-900">{feat}</td>
                          <td className="px-3 py-1.5 text-stone-700">{cnt}</td>
                          <td className="px-3 py-1.5 text-stone-700">{t ? t.tokensIn.toLocaleString() : "—"}</td>
                          <td className="px-3 py-1.5 text-stone-700">{t ? t.tokensOut.toLocaleString() : "—"}</td>
                          <td className="px-3 py-1.5 text-stone-700">{t ? `$${t.cost.toFixed(4)}` : "—"}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-stone-400 mt-3">Tracked features: TUTOR, EMBEDDING, QUIZ_GENERATION, OPEN_ENDED_EVALUATION, CONCEPT_EXTRACTION, RECOMMENDATION.</p>
        </div>

        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">Calls per model</h2>
          {Object.keys(usage.perModel).length === 0 ? (
            <p className="text-sm text-stone-500">No data.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Model</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Calls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {Object.entries(usage.perModel)
                    .sort(([, a], [, b]) => b - a)
                    .map(([model, cnt]) => (
                      <tr key={model} className="hover:bg-stone-50">
                        <td className="px-3 py-1.5 text-stone-900 font-mono text-xs">{model}</td>
                        <td className="px-3 py-1.5 text-stone-700">{cnt}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
        <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">
          Recent failures ({usage.recentFailures.length})
        </h2>
        {usage.recentFailures.length === 0 ? (
          <p className="text-sm text-stone-500">No failures in last 1000 calls — or no calls yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Feature</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Model</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {usage.recentFailures.map((f) => (
                  <tr key={f.id} className="hover:bg-stone-50">
                    <td className="px-3 py-1.5 text-xs text-stone-600">{new Date(f.created_at).toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-stone-900">{f.feature}</td>
                    <td className="px-3 py-1.5 text-xs font-mono text-stone-600">{f.model}</td>
                    <td className="px-3 py-1.5 text-xs text-red-700 max-w-sm truncate" title={f.error ?? ""}>
                      {f.error ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-stone-400 mt-3">
          Source: <code className="bg-stone-100 px-1 rounded">ai_operations where success=false order by created_at desc limit 10</code>. Every AIService call logs success=false on failure per phase 15.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
        <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">
          Recent calls ({usage.recentCalls.length})
        </h2>
        {usage.recentCalls.length === 0 ? (
          <p className="text-sm text-stone-500">No AI calls yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Feature</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Model</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Latency</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Tokens in/out</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Est. cost</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {usage.recentCalls.map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50">
                    <td className="px-3 py-1.5 text-xs text-stone-600 whitespace-nowrap">{new Date(c.created_at).toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-stone-900">{c.feature}</td>
                    <td className="px-3 py-1.5 text-xs font-mono text-stone-600">{c.model}</td>
                    <td className="px-3 py-1.5 text-xs text-stone-600">{c.latencyMs !== null ? `${c.latencyMs}ms` : "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-stone-600">
                      {c.tokensIn !== null ? c.tokensIn.toLocaleString() : "—"} / {c.tokensOut !== null ? c.tokensOut.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-stone-600">{c.estimatedCost !== null ? `$${Number(c.estimatedCost).toFixed(4)}` : "—"}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${c.success ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                        {c.success ? "ok" : "fail"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-stone-400 mt-3">
          Source: <code className="bg-stone-100 px-1 rounded">ai_operations order by created_at desc limit 20</code>. Every AIService call logs one row with latency, tokens, cost, and success.
        </p>
      </div>
    </div>
  );
}
