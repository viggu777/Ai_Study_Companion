import { requireAdmin } from "@/lib/auth/admin";
import { getAdminLearningAnalytics } from "@/services/admin.service";

export const dynamic = "force-dynamic";

export default async function AdminLearningPage() {
  await requireAdmin();

  let data: Awaited<ReturnType<typeof getAdminLearningAnalytics>> | null = null;
  let error: string | null = null;
  try {
    data = await getAdminLearningAnalytics();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Learning Analytics</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const cards = [
    { label: "Concepts", value: data.totalConcepts, sub: "concepts count" },
    { label: "Avg mastery", value: data.avgMastery ?? "—", sub: "avg(concept_mastery)" },
    { label: "Quiz attempts", value: data.totalQuizAttempts, sub: "quizzes count(*)" },
    { label: "Accuracy", value: data.accuracy !== null ? `${data.accuracy}%` : "—", sub: "correct / graded" },
    { label: "Avg score", value: data.avgScore ?? "—", sub: "avg(answers.score)" },
    { label: "Open-ended avg", value: data.avgOpenEnded ?? "—", sub: "avg where evaluation set" },
    { label: "Improving", value: data.improving, sub: "trend delta > +5" },
    { label: "Stable", value: data.stable, sub: "trend within ±5 / no history" },
    { label: "Needs attention", value: data.attention, sub: "trend delta < -5" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Learning Analytics</h1>
        <p className="text-sm text-stone-500 mt-1">
          Platform-wide mastery, assessment and trend aggregates (service role). Trends use the same ±5 rule as
          per-project Growth.
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

      <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
        <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">
          Mastery distribution
        </h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="px-2 py-1 rounded bg-red-50 text-red-700">Beginner (&lt;40): {data.buckets.beginner}</span>
          <span className="px-2 py-1 rounded bg-amber-50 text-amber-700">
            Developing (40–59): {data.buckets.developing}
          </span>
          <span className="px-2 py-1 rounded bg-sky-50 text-sky-700">
            Proficient (60–79): {data.buckets.proficient}
          </span>
          <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700">
            Mastered (80+): {data.buckets.mastered}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">
            Weakest concepts ({data.weakestConcepts.length})
          </h2>
          {data.weakestConcepts.length === 0 ? (
            <p className="text-sm text-stone-500">No mastery data yet.</p>
          ) : (
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Concept</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Mastery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {data.weakestConcepts.map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50">
                    <td className="px-3 py-1.5 text-stone-900">{c.name}</td>
                    <td className="px-3 py-1.5 text-stone-700">{c.mastery}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
          <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider mb-3">
            Strongest concepts ({data.strongestConcepts.length})
          </h2>
          {data.strongestConcepts.length === 0 ? (
            <p className="text-sm text-stone-500">No mastery data yet.</p>
          ) : (
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Concept</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase">Mastery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {data.strongestConcepts.map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50">
                    <td className="px-3 py-1.5 text-stone-900">{c.name}</td>
                    <td className="px-3 py-1.5 text-stone-700">{c.mastery}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-stone-400">
        Source:{" "}
        <code className="bg-stone-100 px-1 rounded">
          concept_mastery (5000) + concepts (2000) + answers (2000) + mastery_history (5000)
        </code>
      </p>
    </div>
  );
}
