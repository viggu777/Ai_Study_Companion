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
          Aggregated ai_operations — calls per feature, average latency, error rate. Full table scans via service role (limit 1000, order by created_at desc).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Total calls</div>
          <div className="text-3xl font-bold text-stone-900 mt-1">{usage.totalCalls}</div>
          <div className="text-xs text-stone-400 mt-1">ai_operations count</div>
        </div>
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Avg latency</div>
          <div className="text-3xl font-bold text-stone-900 mt-1">{usage.avgLatencyMs !== null ? `${usage.avgLatencyMs}ms` : "—"}</div>
          <div className="text-xs text-stone-400 mt-1">avg(latency_ms)</div>
        </div>
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Error rate</div>
          <div className="text-3xl font-bold text-stone-900 mt-1">{usage.errorRate !== null ? `${(usage.errorRate * 100).toFixed(2)}%` : "—"}</div>
          <div className="text-xs text-stone-400 mt-1">fails / total</div>
        </div>
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Features tracked</div>
          <div className="text-3xl font-bold text-stone-900 mt-1">{Object.keys(usage.perFeature).length}</div>
          <div className="text-xs text-stone-400 mt-1">distinct ai_operations features</div>
        </div>
      </div>

      {(usage.totalTokensIn !== null || usage.totalTokensOut !== null) && (
        <div className="bg-white rounded-lg border border-stone-200 p-4 flex flex-wrap gap-4 text-sm">
          {usage.totalTokensIn !== null && <span className="px-2 py-1 rounded bg-stone-100">Tokens in: {usage.totalTokensIn}</span>}
          {usage.totalTokensOut !== null && <span className="px-2 py-1 rounded bg-stone-100">Tokens out: {usage.totalTokensOut}</span>}
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
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {Object.entries(usage.perFeature)
                    .sort(([, a], [, b]) => b - a)
                    .map(([feat, cnt]) => (
                      <tr key={feat} className="hover:bg-stone-50">
                        <td className="px-3 py-1.5 font-medium text-stone-900">{feat}</td>
                        <td className="px-3 py-1.5 text-stone-700">{cnt}</td>
                        <td className="px-3 py-1.5 text-stone-500">{usage.totalCalls > 0 ? ((cnt / usage.totalCalls) * 100).toFixed(1) + "%" : "—"}</td>
                      </tr>
                    ))}
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
    </div>
  );
}
