import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { getGrowthAnalysis } from "@/services/growth.service";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Alert, PageHeader } from "@/components/ui";
import MasteryClient, { type MasteryEntry } from "./MasteryClient";

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

  // Weakest-first: untested (null) counts as 0 so gaps surface at the top.
  const entries: MasteryEntry[] = [...growth]
    .sort((a, b) => (a.currentScore ?? -1) - (b.currentScore ?? -1))
    .map((g) => ({
      conceptId: g.conceptId,
      conceptName: g.conceptName,
      description: g.description,
      previousScore: g.previousScore,
      currentScore: g.currentScore,
      trend: g.trend,
      historyCount: g.historyCount,
    }));

  return (
    <div className="page-enter">
      <PageHeader
        title={`Mastery — ${project.name}`}
        description="Current mastery per concept, updated deterministically after each quiz (new = previous × 0.7 + evidence × 0.3). Weakest first — click a card for details."
      />

      {error ? (
        <Alert>{error}</Alert>
      ) : (
        <MasteryClient entries={entries} />
      )}

      <p className="mt-6 text-xs text-stone-400">
        <Link href={`/projects/${projectId}/growth`} className="text-stone-800 hover:text-stone-900">View growth trends →</Link>
      </p>
    </div>
  );
}
