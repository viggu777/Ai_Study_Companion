import { requireAdmin } from "@/lib/auth/admin";
import { getAdminEngagement } from "@/services/admin.service";

export const dynamic = "force-dynamic";

export default async function AdminEngagementPage() {
  await requireAdmin();

  let data: Awaited<ReturnType<typeof getAdminEngagement>> | null = null;
  let error: string | null = null;
  try {
    data = await getAdminEngagement();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Engagement</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const cards = [
    { label: "DAU (24h)", value: data.dau, sub: "distinct users in learning_events" },
    { label: "WAU (7d)", value: data.wau, sub: "distinct users, last 7 days" },
    { label: "MAU (30d)", value: data.mau, sub: "distinct users, last 30 days" },
    { label: "Active projects (7d)", value: data.activeProjects7d, sub: "distinct project_id in events" },
    { label: "Events (7d)", value: data.events7d, sub: "learning_events last 7d" },
    { label: "Events (30d)", value: data.events30d, sub: "capped at 5000 rows" },
    { label: "Tutor users (7d)", value: data.tutorUsers7d, sub: "TUTOR_* events" },
    { label: "Quiz users (7d)", value: data.quizUsers7d, sub: "QUIZ_*/QUESTION_ANSWERED" },
    { label: "Avg events / WAU", value: data.avgEventsPerWau ?? "—", sub: "events7d / wau" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Engagement</h1>
        <p className="text-sm text-stone-500 mt-1">
          Platform engagement from <code className="bg-stone-100 px-1 rounded text-xs">learning_events</code> (service
          role, 30-day window). New spaces/projects from live counts.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
            <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">{c.label}</div>
            <div className="text-3xl font-bold text-stone-900 mt-1">{c.value}</div>
            <div className="text-xs text-stone-400 mt-1">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">
            Daily active (7d)
          </h2>
          {data.dailyActive7d.length === 0 ? (
            <p className="text-sm text-stone-500">No events in the last 7 days.</p>
          ) : (
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Users</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {data.dailyActive7d.map((d) => (
                  <tr key={d.date} className="hover:bg-stone-50">
                    <td className="px-3 py-1.5 font-mono text-xs text-stone-700">{d.date}</td>
                    <td className="px-3 py-1.5 text-stone-900">{d.users}</td>
                    <td className="px-3 py-1.5 text-stone-700">{d.events}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-stone-400 mt-3">
            New spaces (7d): {data.newSpaces7d} · New projects (7d): {data.newProjects7d}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">
            Events by type (30d)
          </h2>
          {data.byEventType30d.length === 0 ? (
            <p className="text-sm text-stone-500">No events yet.</p>
          ) : (
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Event</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Count</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {data.byEventType30d.map((r) => (
                  <tr key={r.event_type} className="hover:bg-stone-50">
                    <td className="px-3 py-1.5 font-medium text-stone-900 text-xs">{r.event_type}</td>
                    <td className="px-3 py-1.5 text-stone-700">{r.count}</td>
                    <td className="px-3 py-1.5 text-stone-500">
                      {data && data.events30d > 0 ? ((r.count / data.events30d) * 100).toFixed(1) + "%" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
