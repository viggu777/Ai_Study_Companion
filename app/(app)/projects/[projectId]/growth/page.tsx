import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { getGrowthAnalysis } from "@/services/growth.service";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function GrowthPage({ params }: { params: Promise<{ projectId: string }> }) {
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

  const improving = growth.filter((g) => g.trend === "IMPROVING").length;
  const stable = growth.filter((g) => g.trend === "STABLE").length;
  const needs = growth.filter((g) => g.trend === "REQUIRES_ATTENTION").length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Growth — {project.name}</h1>
        <p className="text-sm text-stone-600">Previous vs current mastery; IMPROVING &gt;+5, STABLE ±5, REQUIRES_ATTENTION &lt;-5</p>
      </div>
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4 flex flex-wrap gap-4 text-sm">
          <span className="px-2 py-1 rounded bg-green-50 text-green-700">Improving: {improving}</span>
          <span className="px-2 py-1 rounded bg-stone-100 text-stone-700">Stable: {stable}</span>
          <span className="px-2 py-1 rounded bg-red-50 text-red-700">Requires attention: {needs}</span>
          <span className="ml-auto text-stone-500">{growth.length} concepts</span>
          {growth.length > 0 && (
            <Link href={`/projects/${projectId}/recommendations`} className="text-stone-800 hover:text-stone-900 text-xs">
              View recommendations →
            </Link>
          )}
        </div>

        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
        ) : growth.length === 0 ? (
          <div className="bg-white rounded-lg shadow-card border border-stone-200 p-8 text-center">
            <p className="text-sm text-stone-500">No concepts yet — upload a PDF and complete a quiz to see growth.</p>
            <p className="text-xs text-stone-400 mt-2">Growth is computed from mastery_history: compares two most recent history points per concept.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-card border border-stone-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-stone-200">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Concept</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Previous</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Current</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Delta</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Trend</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-stone-200">
                  {growth.map((g) => (
                    <tr key={g.conceptId} className="hover:bg-stone-50">
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-stone-900">{g.conceptName}</div>
                        {g.description && <div className="text-xs text-stone-500 line-clamp-2 max-w-md">{g.description}</div>}
                        <div className="text-xs text-stone-400">history: {g.historyCount} point(s)</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-stone-700">{g.previousScore !== null ? g.previousScore.toFixed(1) : "—"}</td>
                      <td className="px-6 py-4 text-sm font-medium text-stone-900">{g.currentScore !== null ? g.currentScore.toFixed(1) : "—"}</td>
                      <td className="px-6 py-4 text-sm">
                        {g.delta !== null ? (
                          <span className={g.delta > 0 ? "text-green-600" : g.delta < 0 ? "text-red-600" : "text-stone-500"}>
                            {g.delta > 0 ? "+" : ""}{g.delta.toFixed(1)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            g.trend === "IMPROVING"
                              ? "bg-green-100 text-green-800"
                              : g.trend === "REQUIRES_ATTENTION"
                              ? "bg-red-100 text-red-800"
                              : "bg-stone-100 text-stone-700"
                          }`}
                        >
                          {g.trend}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 bg-stone-50 border-t border-stone-200 text-xs text-stone-500">
              Threshold: Δ &gt;+5 = IMPROVING, Δ &lt;-5 = REQUIRES_ATTENTION, else STABLE. Computed from two most recent mastery_history points (or single point&apos;s previous→new if only one).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
