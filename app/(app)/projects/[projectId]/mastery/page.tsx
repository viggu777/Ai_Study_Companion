import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { getGrowthAnalysis } from "@/services/growth.service";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function MasteryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await getCurrentUser();
  // Independent queries — start together so DB round-trips overlap.
  const projectPromise = getProject(projectId);
  const growthPromise = getGrowthAnalysis(projectId);
  const project = await projectPromise;
  if (!project) notFound();

  let growth: Awaited<ReturnType<typeof getGrowthAnalysis>> = [];
  let error: string | null = null;
  try {
    growth = await growthPromise;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Mastery — {project.name}</h1>
        <p className="text-sm text-stone-600">Current mastery per concept, updated deterministically after each quiz (new = previous × 0.7 + evidence × 0.3)</p>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      ) : growth.length === 0 ? (
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-8 text-center">
          <p className="text-sm text-stone-500">No concepts yet — upload a PDF and complete a quiz to see mastery.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {growth.map((g) => (
            <div key={g.conceptId} className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
              <h3 className="font-semibold text-stone-900">{g.conceptName}</h3>
              {g.description && <p className="mt-1 text-sm text-stone-500 line-clamp-2">{g.description}</p>}
              <div className="mt-3 flex items-end gap-2">
                <span className="text-3xl font-bold text-stone-900">
                  {g.currentScore !== null ? g.currentScore.toFixed(0) : "—"}
                </span>
                <span className="pb-1 text-xs text-stone-400">/ 100</span>
                <span
                  className={`ml-auto inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    g.trend === "IMPROVING"
                      ? "bg-green-100 text-green-800"
                      : g.trend === "REQUIRES_ATTENTION"
                      ? "bg-red-100 text-red-800"
                      : "bg-stone-100 text-stone-700"
                  }`}
                >
                  {g.trend}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100">
                <div
                  className="h-full rounded-full bg-sky-600 transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, g.currentScore ?? 0))}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-stone-400">
                {g.previousScore !== null ? `Previous ${g.previousScore.toFixed(1)}` : "Not yet tested"} · history: {g.historyCount} point(s)
              </p>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-stone-400">
        <Link href={`/projects/${projectId}/growth`} className="text-stone-800 hover:text-stone-800">View growth trends →</Link>
      </p>
    </div>
  );
}
