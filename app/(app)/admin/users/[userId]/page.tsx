import { requireAdmin } from "@/lib/auth/admin";
import { getAdminUserDetail } from "@/services/admin.service";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({ params }: { params: { userId: string } }) {
  await requireAdmin();

  let detail: Awaited<ReturnType<typeof getAdminUserDetail>> | null = null;
  let error: string | null = null;
  try {
    detail = await getAdminUserDetail(params.userId);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/admin/users" className="text-sm text-stone-800 hover:text-stone-900">
          ← Back to users
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  if (!detail) return null;

  const spaceNameById = new Map(detail.spaces.map((s) => [s.id, s.name] as const));

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link href="/admin/users" className="text-sm text-stone-800 hover:text-stone-900">
          ← Users
        </Link>
        <span className="text-stone-300">/</span>
        <span className="text-sm font-mono text-stone-700">{detail.userId.slice(0, 8)}…</span>
        <span className="text-sm text-stone-900 font-medium">{detail.email ?? "—"}</span>
        <span className="text-xs text-stone-400">{detail.created_at ? `created ${new Date(detail.created_at).toLocaleString()}` : ""}</span>
      </div>

      {/* Projects */}
      <section>
        <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-2">
          Projects ({detail.projects.length}) — via projects where user_id
        </h2>
        {detail.projects.length === 0 ? (
          <p className="text-sm text-stone-500 bg-white border rounded-lg p-4">No projects for this user.</p>
        ) : (
          <div className="bg-white rounded-lg border border-stone-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Project</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Space</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {detail.projects.map((p) => (
                    <tr key={p.id} className="hover:bg-stone-50">
                      <td className="px-4 py-2 font-medium text-stone-900">
                        {p.name}
                        <div className="text-xs text-stone-500 font-mono">{p.id.slice(0, 8)}…</div>
                      </td>
                      <td className="px-4 py-2 text-stone-600">{spaceNameById.get(p.space_id) ?? p.space_id.slice(0, 8)}</td>
                      <td className="px-4 py-2 text-stone-600">{new Date(p.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Activity */}
      <section>
        <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-2">
          Activity — last {detail.recentEvents.length} learning_events
        </h2>
        {detail.recentEvents.length === 0 ? (
          <p className="text-sm text-stone-500 bg-white border rounded-lg p-4">No learning_events yet.</p>
        ) : (
          <div className="bg-white rounded-lg border border-stone-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Time</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Event</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Entity</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Project</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {detail.recentEvents.map((e) => (
                    <tr key={e.id} className="hover:bg-stone-50">
                      <td className="px-3 py-1.5 text-xs text-stone-600">{new Date(e.created_at).toLocaleString()}</td>
                      <td className="px-3 py-1.5">
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-stone-100 text-stone-800">{e.event_type}</span>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-stone-600 font-mono">
                        {e.entity_type}:{String(e.entity_id).slice(0, 8)}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-stone-600 font-mono">{e.project_id ? e.project_id.slice(0, 8) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="text-xs text-stone-400 mt-2">
          Source: <code className="bg-stone-100 px-1 rounded">learning_events where user_id order by created_at desc limit 50</code>
        </p>
      </section>

      {/* Assessments */}
      <section>
        <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-2">
          Assessments — {detail.assessments.totalAnswers} answers, avg {detail.assessments.avgScore ?? "—"}
        </h2>
        {detail.assessments.byScore.length === 0 ? (
          <p className="text-sm text-stone-500 bg-white border rounded-lg p-4">No answers yet — complete a quiz first.</p>
        ) : (
          <div className="bg-white rounded-lg border border-stone-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Time</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Score</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Correct</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {detail.assessments.byScore.map((a, i) => (
                    <tr key={i} className="hover:bg-stone-50">
                      <td className="px-3 py-1.5 text-xs text-stone-600">{new Date(a.created_at).toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-stone-900">{a.score ?? "—"}</td>
                      <td className="px-3 py-1.5">
                        {a.is_correct === null ? "—" : a.is_correct ? <span className="text-green-700">yes</span> : <span className="text-red-700">no</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="text-xs text-stone-400 mt-2">Source: answers where user_id; avg = avg(score).</p>
      </section>

      {/* Mastery */}
      <section>
        <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-2">
          Mastery — {detail.mastery.length} concept_mastery rows
        </h2>
        {detail.mastery.length === 0 ? (
          <p className="text-sm text-stone-500 bg-white border rounded-lg p-4">No mastery yet — complete a quiz to generate mastery scores.</p>
        ) : (
          <div className="bg-white rounded-lg border border-stone-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200 text-sm">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Concept</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Project</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {detail.mastery.map((m) => (
                    <tr key={m.concept_id} className="hover:bg-stone-50">
                      <td className="px-3 py-1.5 text-stone-900">
                        {m.conceptName ?? m.concept_id.slice(0, 8)}
                        <div className="text-xs font-mono text-stone-400">{m.concept_id.slice(0, 8)}…</div>
                      </td>
                      <td className="px-3 py-1.5 text-xs font-mono text-stone-600">{m.project_id.slice(0, 8)}…</td>
                      <td className="px-3 py-1.5 text-stone-900 font-mono">{Number(m.mastery_score).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {detail.masteryHistory.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">Recent mastery_history</h3>
            <div className="bg-white rounded-lg border border-stone-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-stone-200 text-xs">
                  <thead className="bg-stone-50">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium text-stone-500 uppercase">Time</th>
                      <th className="px-3 py-1.5 text-left font-medium text-stone-500 uppercase">Concept</th>
                      <th className="px-3 py-1.5 text-left font-medium text-stone-500 uppercase">Prev → New</th>
                      <th className="px-3 py-1.5 text-left font-medium text-stone-500 uppercase">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {detail.masteryHistory.map((h) => (
                      <tr key={`${h.concept_id}-${h.created_at}`} className="hover:bg-stone-50">
                        <td className="px-3 py-1 text-stone-600">{new Date(h.created_at).toLocaleString()}</td>
                        <td className="px-3 py-1 font-mono text-stone-600">{h.concept_id.slice(0, 8)}…</td>
                        <td className="px-3 py-1 font-mono text-stone-900">
                          {h.previous_score.toFixed(1)} → {h.new_score.toFixed(1)}
                        </td>
                        <td className="px-3 py-1 text-stone-600 truncate max-w-[20rem]">{h.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* AI Usage */}
      <section>
        <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-2">
          AI Usage — {detail.aiUsage.totalCalls} calls, avg {detail.aiUsage.avgLatencyMs ?? "—"}ms, error {(detail.aiUsage.errorRate !== null ? (detail.aiUsage.errorRate * 100).toFixed(1) + "%" : "—")}
        </h2>
        <div className="bg-white rounded-lg border border-stone-200 p-4">
          {Object.keys(detail.aiUsage.perFeature).length === 0 ? (
            <p className="text-sm text-stone-500">No ai_operations for this user yet.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                {Object.entries(detail.aiUsage.perFeature).map(([feat, cnt]) => (
                  <span key={feat} className="px-2 py-1 rounded bg-stone-100 text-xs font-medium text-stone-700">
                    {feat}: {cnt}
                  </span>
                ))}
                {detail.aiUsage.totalCost !== null && (
                  <span className="px-2 py-1 rounded bg-green-50 text-green-700 text-xs">Est. cost ${detail.aiUsage.totalCost}</span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-stone-200 text-sm">
                  <thead className="bg-stone-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Time</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Feature</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Model</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Latency</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Success</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {detail.aiUsage.recent.map((r, i) => (
                      <tr key={i} className="hover:bg-stone-50">
                        <td className="px-3 py-1.5 text-xs text-stone-600">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-stone-900">{r.feature}</td>
                        <td className="px-3 py-1.5 text-xs text-stone-600">{r.model}</td>
                        <td className="px-3 py-1.5 text-stone-700">{r.latency_ms}ms</td>
                        <td className="px-3 py-1.5">{r.success ? <span className="text-green-700">ok</span> : <span className="text-red-700" title={r.error ?? ""}>fail</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="text-xs text-stone-400 mt-3">Source: ai_operations where user_id (service role).</p>
        </div>
      </section>
    </div>
  );
}
