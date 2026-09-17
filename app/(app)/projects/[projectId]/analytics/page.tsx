import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { getProjectAnalytics } from "@/services/analytics.service";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function AnalyticsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await getCurrentUser();
  // Independent queries — start together so DB round-trips overlap.
  const projectPromise = getProject(projectId);
  const analyticsPromise = getProjectAnalytics(projectId);
  const project = await projectPromise;
  if (!project) notFound();

  let analytics: Awaited<ReturnType<typeof getProjectAnalytics>> | null = null;
  let error: string | null = null;
  try {
    analytics = await analyticsPromise;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Analytics — {project.name}</h1>
          <p className="text-sm text-stone-600">Real aggregations from learning_events, answers, concept_mastery, ai_operations</p>
        </div>
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
        </div>
      </div>
    );
  }

  const a = analytics!;

  return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Analytics — {project.name}</h1>
          <p className="text-sm text-stone-600">Real aggregations from learning_events, answers, concept_mastery, ai_operations</p>
        </div>

      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        {/* Learning activity */}
        <section>
          <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">Learning activity</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
              <div className="text-xs text-stone-500">Tutor sessions</div>
              <div className="text-2xl font-semibold tracking-tight text-stone-900">{a.learningActivity.tutorSessions}</div>
              <div className="text-xs text-stone-400">conversations (project scoped)</div>
            </div>
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
              <div className="text-xs text-stone-500">Quiz attempts</div>
              <div className="text-2xl font-semibold tracking-tight text-stone-900">{a.learningActivity.quizAttempts}</div>
              <div className="text-xs text-stone-400">quizzes where project_id = this</div>
            </div>
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
              <div className="text-xs text-stone-500">Questions answered</div>
              <div className="text-2xl font-semibold tracking-tight text-stone-900">{a.learningActivity.questionsAnswered}</div>
              <div className="text-xs text-stone-400">answers via questions → quiz → project</div>
            </div>
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
              <div className="text-xs text-stone-500">Tutor messages sent</div>
              <div className="text-2xl font-semibold tracking-tight text-stone-900">{a.learningActivity.tutorMessagesSent}</div>
              <div className="text-xs text-stone-400">learning_events TUTOR_MESSAGE_SENT</div>
            </div>
          </div>
          <p className="text-xs text-stone-400 mt-2">Sources: conversations, quizzes, answers, learning_events where project_id = this project.</p>
        </section>

        {/* Assessment */}
        <section>
          <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">Assessment</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
              <div className="text-xs text-stone-500">Average quiz score</div>
              <div className="text-2xl font-semibold tracking-tight text-stone-900">{a.assessment.averageScore !== null ? `${a.assessment.averageScore.toFixed(1)}` : "—"}</div>
              <div className="text-xs text-stone-400">avg score across {a.assessment.totalAnswers} answers</div>
            </div>
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
              <div className="text-xs text-stone-500">Average open-ended score</div>
              <div className="text-2xl font-semibold tracking-tight text-stone-900">{a.assessment.averageOpenEndedScore !== null ? a.assessment.averageOpenEndedScore.toFixed(1) : "—"}</div>
              <div className="text-xs text-stone-400">{a.assessment.openEndedCount} open-ended graded</div>
            </div>
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
              <div className="text-xs text-stone-500">Accuracy</div>
              <div className="text-2xl font-semibold tracking-tight text-stone-900">{a.assessment.accuracy !== null ? `${a.assessment.accuracy.toFixed(1)}%` : "—"}</div>
              <div className="text-xs text-stone-400">is_correct true / is_correct not null</div>
            </div>
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
              <div className="text-xs text-stone-500">Split</div>
              <div className="text-sm font-medium text-stone-900">MCQ {a.assessment.mcqCount} · Open-ended {a.assessment.openEndedCount}</div>
              <div className="text-xs text-stone-400">questions answered breakdown</div>
            </div>
          </div>

          {a.assessment.accuracyOverTime.length > 0 ? (
            <div className="bg-white rounded-lg shadow-card border border-stone-200 overflow-hidden mt-4">
              <div className="px-4 py-2 border-b border-stone-200 text-xs font-medium text-stone-600">Accuracy over time (by answer date)</div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-stone-200 text-sm">
                  <thead className="bg-stone-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Count</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Accuracy</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Avg score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {a.assessment.accuracyOverTime.map((r) => (
                      <tr key={r.date} className="hover:bg-stone-50">
                        <td className="px-4 py-2 text-stone-900">{r.date}</td>
                        <td className="px-4 py-2 text-stone-700">{r.count}</td>
                        <td className="px-4 py-2 text-stone-700">{r.accuracy !== null ? `${r.accuracy.toFixed(1)}%` : "—"}</td>
                        <td className="px-4 py-2 text-stone-700">{r.avgScore !== null ? r.avgScore.toFixed(1) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 bg-stone-50 text-xs text-stone-400">Grouped by answers.created_at → date. Verify: count rows per date should match SELECT date(created_at), count(*) FROM answers where … GROUP BY date.</div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4 mt-4 text-sm text-stone-500">No answers yet — accuracy over time will appear after you submit a quiz.</div>
          )}
        </section>

        {/* Mastery */}
        <section>
          <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">Mastery</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
              <div className="text-xs text-stone-500">Avg mastery</div>
              <div className="text-2xl font-semibold tracking-tight text-stone-900">{a.mastery.avgMastery !== null ? a.mastery.avgMastery.toFixed(1) : "—"}</div>
              <div className="text-xs text-stone-400">across {a.mastery.totalConcepts} concepts</div>
            </div>
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
              <div className="text-xs text-stone-500">Improving</div>
              <div className="text-2xl font-semibold tracking-tight text-green-600">{a.mastery.improvingCount}</div>
              <div className="text-xs text-stone-400">trend IMPROVING (Δ &gt;5)</div>
            </div>
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
              <div className="text-xs text-stone-500">Stable</div>
              <div className="text-2xl font-semibold tracking-tight text-stone-700">{a.mastery.stableCount}</div>
              <div className="text-xs text-stone-400">trend STABLE</div>
            </div>
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
              <div className="text-xs text-stone-500">Requires attention</div>
              <div className="text-2xl font-semibold tracking-tight text-red-600">{a.mastery.requiresAttentionCount}</div>
              <div className="text-xs text-stone-400">trend REQUIRES_ATTENTION (Δ &lt;-5)</div>
            </div>
          </div>
          {a.mastery.perConcept.length > 0 ? (
            <div className="bg-white rounded-lg shadow-card border border-stone-200 overflow-hidden mt-4">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-stone-200 text-sm">
                  <thead className="bg-stone-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Concept</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Mastery</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {a.mastery.perConcept.map((c) => (
                      <tr key={c.conceptId} className="hover:bg-stone-50">
                        <td className="px-4 py-2 text-stone-900">{c.name}</td>
                        <td className="px-4 py-2 text-stone-700">{c.mastery !== null ? c.mastery.toFixed(1) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 bg-stone-50 text-xs text-stone-400">
                <Link href={`/projects/${projectId}/growth`} className="text-stone-800 hover:text-stone-900">View growth trends →</Link>
                <span className="mx-2">·</span>
                <Link href={`/projects/${projectId}/mastery`} className="text-stone-800 hover:text-stone-900">View mastery →</Link>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4 mt-4 text-sm text-stone-500">No concepts yet — upload material to generate concepts.</div>
          )}
        </section>

        {/* AI activity */}
        <section>
          <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">AI activity (this project)</h2>
          <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
            <div className="flex flex-wrap gap-4 text-sm mb-3">
              <span className="px-2 py-1 rounded bg-stone-100">Total calls: {a.aiActivity.totalCalls}</span>
              {a.aiActivity.avgLatencyMs !== null && <span className="px-2 py-1 rounded bg-stone-100 text-stone-800">Avg latency: {a.aiActivity.avgLatencyMs}ms</span>}
              {a.aiActivity.errorRate !== null && <span className="px-2 py-1 rounded bg-red-50 text-red-700">Error rate: {(a.aiActivity.errorRate * 100).toFixed(1)}%</span>}
            </div>
            {Object.keys(a.aiActivity.perFeature).length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-stone-200 text-sm">
                  <thead className="bg-stone-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Feature</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Calls</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {Object.entries(a.aiActivity.perFeature).map(([feat, count]) => (
                      <tr key={feat} className="hover:bg-stone-50">
                        <td className="px-4 py-2 text-stone-900">{feat}</td>
                        <td className="px-4 py-2 text-stone-700">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-stone-500">No AI calls yet for this project — try Tutor or generate a quiz.</p>
            )}
            <p className="text-xs text-stone-400 mt-3">Source: ai_operations where project_id = this project. Verify: SELECT feature, count(*) FROM ai_operations WHERE project_id = $1 GROUP BY feature.</p>
          </div>
        </section>

        <div className="text-xs text-stone-400">
          All numbers are live aggregations (no mocks). Check manually: counts should match SELECT count(*) on the cited tables for this project_id + your user_id.
        </div>
      </div>
    </div>
  );
}
