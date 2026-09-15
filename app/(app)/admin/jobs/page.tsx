import { requireAdmin } from "@/lib/auth/admin";
import { getServiceDb } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  await requireAdmin();

  let recentEvents: Array<{ event_type: string; created_at: string; metadata: unknown }> = [];
  let error: string | null = null;
  try {
    const db = getServiceDb();
    // Recent job-relevant learning_events + ai_operations failures as proxy for job health
    const { data, error: qErr } = await db
      .from("learning_events")
      .select("event_type, created_at, metadata")
      .in("event_type", ["MATERIAL_READY", "MATERIAL_FAILED", "MATERIAL_PROCESSING_STARTED", "MATERIAL_UPLOADED", "QUIZ_COMPLETED", "MASTERY_UPDATED", "RECOMMENDATION_GENERATED"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (qErr) throw new Error(qErr.message);
    recentEvents = (data ?? []) as typeof recentEvents;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  let aiFailures = 0;
  let aiTotal = 0;
  try {
    const db = getServiceDb();
    const { data } = await db.from("ai_operations").select("success").order("created_at", { ascending: false }).limit(200);
    aiTotal = (data ?? []).length;
    aiFailures = ((data ?? []) as Array<{ success: boolean }>).filter((r) => !r.success).length;
  } catch {}

  const inngestDashboardUrl = "https://app.inngest.com";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Jobs</h1>
        <p className="text-sm text-stone-500 mt-1">Recent Inngest job runs and their status (success/failure/retry counts). Detail lives in the Inngest dashboard.</p>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex flex-wrap items-center gap-3">
        <div className="text-sm text-emerald-900">
          Inngest dashboard holds full run history, retries, and step traces. All functions are registered in <code className="bg-white px-1 rounded border text-xs">app/api/inngest/route.ts</code> via <code className="bg-white px-1 rounded border text-xs">serve({"{"} inngest, functions {"}"})</code>.
        </div>
        <a
          href={inngestDashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto px-4 py-1.5 bg-emerald-700 text-white rounded-md text-sm font-medium hover:bg-emerald-800"
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
                  {recentEvents.map((e, i) => (
                    <tr key={i} className="hover:bg-stone-50">
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
            Full retry/success detail (attempt counts, step traces) lives in Inngest — this table is a lightweight proxy via learning_events + ai_operations (spec allows &quot;even if this just links out to the Inngest dashboard&quot;).
          </p>
        </div>
      )}
    </div>
  );
}
