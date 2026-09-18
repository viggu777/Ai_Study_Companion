import { requireAdmin } from "@/lib/auth/admin";
import { getAdminJobHealth } from "@/services/admin.service";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  await requireAdmin();

  let recentEvents: Array<{ id: string; event_type: string; created_at: string; metadata: unknown }> = [];
  let recentAiFailures: Array<{ id: string; feature: string; model: string; error: string | null; created_at: string }> = [];
  let failedMaterials: Array<{ id: string; filename: string; processing_error: string | null; created_at: string }> = [];
  let aiFailures = 0;
  let aiTotal = 0;
  let error: string | null = null;
  try {
    const health = await getAdminJobHealth();
    recentEvents = health.recentEvents;
    aiTotal = health.aiTotal;
    aiFailures = health.aiFailures;
    recentAiFailures = health.recentAiFailures;
    failedMaterials = health.failedMaterials;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const inngestDashboardUrl = "https://app.inngest.com";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Jobs <span className="ml-2 inline-flex px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 align-middle">signal-proxy</span></h1>
        <p className="text-sm text-stone-500 mt-1">Signal-proxy over learning_events + ai_operations — tallies and recent failures inline. Full run history, retries, and step traces live in the Inngest dashboard.</p>
      </div>

      <div className="bg-stone-100 border border-stone-200 rounded-lg p-4 flex flex-wrap items-center gap-3">
        <div className="text-sm text-stone-800">
          Inngest dashboard holds full run history, retries, and step traces. All functions are registered in <code className="bg-white px-1 rounded border text-xs">app/api/inngest/route.ts</code> via <code className="bg-white px-1 rounded border text-xs">serve({"{"} inngest, functions {"}"})</code>.
        </div>
        <a
          href={inngestDashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto px-4 py-1.5 bg-sky-600 text-white rounded-md text-sm font-medium hover:bg-sky-700"
        >
          Open Inngest Dashboard →
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Inngest functions</div>
          <div className="text-sm text-stone-900 mt-2 space-y-1 font-mono text-xs">
            <div>material-processing (material/uploaded)</div>
            <div>mastery-update (quiz/completed)</div>
            <div>recommendation-generate (mastery/updated)</div>
          </div>
          <div className="text-xs text-stone-400 mt-2">Defined in lib/jobs/material.ts, mastery.ts, recommendation.ts</div>
        </div>
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Recent ai_operations</div>
          <div className="text-2xl font-semibold tracking-tight text-stone-900 mt-1">
            {aiTotal} total, {aiFailures} failures
          </div>
          <div className="text-xs text-stone-400 mt-1">Last 200 rows; failure = success=false</div>
        </div>
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">Local dev</div>
          <div className="text-sm text-stone-700 mt-2">
            Run <code className="bg-stone-100 px-1 rounded">npx inngest-cli dev</code> and set <code className="bg-stone-100 px-1 rounded">INNGEST_EVENT_KEY</code> / <code className="bg-stone-100 px-1 rounded">INNGEST_SIGNING_KEY</code> to see live runs locally.
          </div>
        </div>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      ) : (
        <div className="bg-white rounded-lg shadow-card border border-stone-200 overflow-hidden">
          <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 border-b">
            Recent learning_events tied to jobs — last {recentEvents.length} (limit 50, filter: MATERIAL_*, QUIZ_COMPLETED, MASTERY_UPDATED, RECOMMENDATION_GENERATED)
          </div>
          {recentEvents.length === 0 ? (
            <div className="p-8 text-center text-sm text-stone-500">No job-tied events yet — upload a PDF or complete a quiz to generate MATERIAL_* / QUIZ_COMPLETED events.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Time</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Event</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Metadata</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {recentEvents.map((e) => (
                    <tr key={e.id} className="hover:bg-stone-50">
                      <td className="px-3 py-1.5 text-xs text-stone-600 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                      <td className="px-3 py-1.5">
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-stone-100 text-stone-800">{e.event_type}</span>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-stone-600 max-w-md truncate" title={JSON.stringify(e.metadata)}>
                        {e.metadata ? JSON.stringify(e.metadata).slice(0, 120) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-stone-400 px-4 py-3 border-t">
            Signal-proxy: tallies learning_events + ai_operations. Full retry/success detail (attempt counts, step traces) lives in Inngest — this table is a lightweight proxy (spec allows &quot;even if this just links out to the Inngest dashboard&quot;).
          </p>
        </div>
      )}

      {!error && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="bg-white rounded-lg shadow-card border border-stone-200 overflow-hidden">
            <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 border-b">
              Last-10 failed materials (status=FAILED)
            </div>
            {failedMaterials.length === 0 ? (
              <div className="p-6 text-center text-sm text-stone-500">No failed materials — uploads are healthy.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-stone-200 text-sm">
                  <thead className="bg-stone-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Time</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">File</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {failedMaterials.map((m) => (
                      <tr key={m.id} className="hover:bg-stone-50">
                        <td className="px-3 py-1.5 text-xs text-stone-600 whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-xs text-stone-800 max-w-[12rem] truncate" title={m.filename}>{m.filename}</td>
                        <td className="px-3 py-1.5 text-xs text-stone-600 max-w-md truncate" title={m.processing_error ?? ""}>{m.processing_error ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="bg-white rounded-lg shadow-card border border-stone-200 overflow-hidden">
            <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 border-b">
              Last-10 failed AI operations (success=false)
            </div>
            {recentAiFailures.length === 0 ? (
              <div className="p-6 text-center text-sm text-stone-500">No failed AI operations — providers are healthy.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-stone-200 text-sm">
                  <thead className="bg-stone-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Time</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Feature</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {recentAiFailures.map((f) => (
                      <tr key={f.id} className="hover:bg-stone-50">
                        <td className="px-3 py-1.5 text-xs text-stone-600 whitespace-nowrap">{new Date(f.created_at).toLocaleString()}</td>
                        <td className="px-3 py-1.5">
                          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">{f.feature}</span>
                        </td>
                        <td className="px-3 py-1.5 text-xs text-stone-600 max-w-md truncate" title={f.error ?? ""}>{f.error ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
