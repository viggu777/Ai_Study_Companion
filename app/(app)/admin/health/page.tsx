import { requireAdmin } from "@/lib/auth/admin";
import { getAdminSystemHealth, type HealthCheckStatus } from "@/services/admin.service";

export const dynamic = "force-dynamic";

function badgeClass(status: HealthCheckStatus): string {
  if (status === "ok") return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20";
  if (status === "degraded") return "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20";
  if (status === "not_configured") return "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/25";
  return "bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-500/10";
}

function statusLabel(status: HealthCheckStatus): string {
  if (status === "ok") return "OK";
  if (status === "degraded") return "FAILING";
  if (status === "not_configured") return "NOT CONFIGURED";
  return "UNCHECKABLE";
}

export default async function AdminHealthPage() {
  await requireAdmin();

  let health: Awaited<ReturnType<typeof getAdminSystemHealth>> | null = null;
  let error: string | null = null;
  try {
    health = await getAdminSystemHealth();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">System Health</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700" role="alert">
          System health check failed: {error}
        </div>
      </div>
    );
  }

  if (!health) return null;
  const healthy = health.overall === "HEALTHY";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">System Health</h1>
        <p className="text-sm text-stone-500 mt-1">
          Lightweight live probes — database, storage, AI configuration, embeddings, background jobs — plus
          recent failures. Checked at {new Date(health.checkedAt).toLocaleString()}. No secret values are shown.
        </p>
      </div>

      <div
        role="status"
        className={`rounded-lg border p-4 flex flex-wrap items-center gap-3 ${
          healthy ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
        }`}
      >
        <span
          className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold tracking-wider ${
            healthy ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {health.overall}
        </span>
        <p className={`text-sm ${healthy ? "text-emerald-800" : "text-red-800"}`}>
          {healthy
            ? "All critical dependencies report OK."
            : "One or more critical checks need attention — see the failing cards below."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {health.checks.map((check) => (
          <div key={check.key} className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">{check.label}</div>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${badgeClass(check.status)}`}>
                {statusLabel(check.status)}
              </span>
            </div>
            <p className="text-sm text-stone-700 mt-2">{check.detail}</p>
            {typeof check.latencyMs === "number" && (
              <p className="text-xs text-stone-400 mt-2 tnum">Latency: {check.latencyMs}ms</p>
            )}
          </div>
        ))}
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Failures (last 24h)</div>
          <div className="text-2xl font-semibold tracking-tight text-stone-900 mt-1 tnum">
            {health.aiFailureCount24h ?? "—"} AI · {health.materialFailedCount24h ?? "—"} material
          </div>
          <div className="text-xs text-stone-400 mt-1">ai_operations success=false · MATERIAL_FAILED events</div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
        <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">
          Recent AI failures ({health.recentAiFailures.length})
        </h2>
        {health.recentAiFailures.length === 0 ? (
          <p className="text-sm text-stone-500">No AI failures recorded recently — or the failure query was unreachable.</p>
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
                {health.recentAiFailures.map((f) => (
                  <tr key={f.id} className="hover:bg-stone-50">
                    <td className="px-3 py-1.5 text-xs text-stone-600 whitespace-nowrap">{new Date(f.created_at).toLocaleString()}</td>
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
      </div>

      <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
        <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">
          Failed materials ({health.failedMaterials.length} latest)
        </h2>
        {health.failedMaterials.length === 0 ? (
          <p className="text-sm text-stone-500">No materials in FAILED status.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">File</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Error</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Since</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {health.failedMaterials.map((m) => (
                  <tr key={m.id} className="hover:bg-stone-50">
                    <td className="px-3 py-1.5 text-stone-900 font-mono text-xs">{m.filename}</td>
                    <td className="px-3 py-1.5 text-xs text-red-700 max-w-sm truncate" title={m.processing_error ?? ""}>
                      {m.processing_error ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-stone-600 whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-stone-400 mt-3">
          Retry from the project Materials page. Active provider: {health.chatProvider}
          {health.chatModel ? ` (${health.chatModel})` : ""} · embeddings: {health.embeddingProvider} ({health.embeddingModel}).
        </p>
      </div>

      <p className="text-xs text-stone-400">
        Probes: database + storage are live queries (4s timeout); AI chat is a configuration check only (no live
        call, no cost); local embeddings get one short HTTP probe; Inngest status is key presence plus the last
        24h of learning events. Anything unreachable renders UNCHECKABLE instead of crashing the page.
      </p>
    </div>
  );
}
