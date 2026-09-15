import { requireAdmin } from "@/lib/auth/admin";
import { listAdminActivity } from "@/services/admin.service";

export const dynamic = "force-dynamic";

const EVENT_TYPES = [
  "SPACE_CREATED",
  "PROJECT_CREATED",
  "MATERIAL_UPLOADED",
  "MATERIAL_PROCESSING_STARTED",
  "MATERIAL_READY",
  "MATERIAL_FAILED",
  "TUTOR_MESSAGE_SENT",
  "TUTOR_RESPONSE_GENERATED",
  "QUIZ_STARTED",
  "QUESTION_ANSWERED",
  "QUIZ_COMPLETED",
  "ASSESSMENT_COMPLETED",
  "MASTERY_UPDATED",
  "RECOMMENDATION_GENERATED",
  "RECOMMENDATION_COMPLETED",
];

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams?: {
    userId?: string;
    spaceId?: string;
    projectId?: string;
    eventType?: string;
    from?: string;
    to?: string;
  };
}) {
  await requireAdmin();

  const userId = searchParams?.userId?.trim() || undefined;
  const spaceId = searchParams?.spaceId?.trim() || undefined;
  const projectId = searchParams?.projectId?.trim() || undefined;
  const eventType = searchParams?.eventType?.trim() || undefined;
  const from = searchParams?.from?.trim() || undefined;
  const to = searchParams?.to?.trim() || undefined;

  let events: Awaited<ReturnType<typeof listAdminActivity>> = [];
  let error: string | null = null;
  try {
    events = await listAdminActivity({ userId, spaceId, projectId, eventType, from, to, limit: 100 });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Activity</h1>
      <p className="text-sm text-stone-500">Filterable feed over learning_events (service role). Filter by user, space, project, event type, time period.</p>

      <form method="GET" className="bg-white border border-stone-200 rounded-lg p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">User ID</label>
            <input name="userId" defaultValue={userId ?? ""} placeholder="uuid" className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">Space ID</label>
            <input name="spaceId" defaultValue={spaceId ?? ""} placeholder="uuid" className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">Project ID</label>
            <input name="projectId" defaultValue={projectId ?? ""} placeholder="uuid" className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">Event type</label>
            <select name="eventType" defaultValue={eventType ?? ""} className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm">
              <option value="">All</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">From (ISO)</label>
            <input name="from" type="datetime-local" defaultValue={from ?? ""} className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">To (ISO)</label>
            <input name="to" type="datetime-local" defaultValue={to ?? ""} className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm" />
          </div>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="px-4 py-1.5 bg-emerald-700 text-white rounded-md text-sm font-medium hover:bg-emerald-800">
            Apply filters
          </button>
          <a href="/admin/activity" className="px-4 py-1.5 bg-stone-100 text-stone-700 rounded-md text-sm hover:bg-stone-200">
            Clear
          </a>
        </div>
      </form>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      ) : events.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-lg p-8 text-center text-sm text-stone-500">No events match the current filters.</div>
      ) : (
        <div className="bg-white rounded-lg shadow-card border border-stone-200 overflow-hidden">
          <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 border-b">Showing {events.length} events (limit 100, order by created_at desc)</div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Event</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">User</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Space</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Project</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Entity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {events.map((e) => (
                  <tr key={e.id} className="hover:bg-stone-50">
                    <td className="px-3 py-1.5 text-xs text-stone-600 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-stone-100 text-stone-800">{e.event_type}</span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs text-stone-600">{e.user_id.slice(0, 8)}…</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-stone-600">{e.space_id ? e.space_id.slice(0, 8) + "…" : "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-stone-600">{e.project_id ? e.project_id.slice(0, 8) + "…" : "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-stone-600">
                      {e.entity_type}:{String(e.entity_id).slice(0, 8)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-stone-400 px-4 py-3 border-t">
            Source: <code className="bg-stone-100 px-1 rounded">getServiceDb().from(&quot;learning_events&quot;).select(...).eq(...).gte(&quot;created_at&quot;).lte(...).range()</code> — index on (project_id, created_at).
          </p>
        </div>
      )}
    </div>
  );
}
