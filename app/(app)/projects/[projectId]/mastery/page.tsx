import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { backfillMissingQuizMastery, getMasteryOverview } from "@/services/mastery.service";
import { listMaterials } from "@/services/material.service";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Alert } from "@/components/ui";
import MasteryClient from "./MasteryClient";

export default async function MasteryPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{ concept?: string }>;
}) {
  const { projectId } = await params;
  const conceptId = (await searchParams)?.concept?.trim() || null;
  await getCurrentUser();

  // Single unified source: quiz + practice + flashcard evidence merged.
  const projectPromise = getProject(projectId);
  const overviewPromise = getMasteryOverview(projectId).catch((e: unknown) => {
    throw e;
  });
  const materialsPromise = listMaterials(projectId).catch(
    () => [] as Array<{ id: string; filename: string }>
  );

  const project = await projectPromise;
  if (!project) notFound();

  let overview: Awaited<ReturnType<typeof getMasteryOverview>> | null = null;
  let error: string | null = null;
  try {
    overview = await overviewPromise;
    // Self-heal: finished quizzes that never reached the mastery worker leave
    // zero evidence — or partial evidence where an older quiz was skipped and
    // every concept sits at 0-1 history rows (Growth then shows all-New zeros
    // even after 2 quizzes). Recompute inline (idempotent, oldest-first) and
    // re-read once so pages reflect real progress instead of stuck zeros.
    const noEvidence =
      overview &&
      overview.summary.quizEvents === 0 &&
      overview.summary.practiceEvents === 0 &&
      overview.summary.flashcardReviews === 0;
    const noTrends =
      overview &&
      overview.entries.length > 0 &&
      overview.entries.every((e) => e.historyCount < 2);
    if (overview && (noEvidence || noTrends)) {
      try {
        const user = await getCurrentUser();
        const healed = await backfillMissingQuizMastery(projectId, user.id, 10);
        if (healed.updated > 0) overview = await getMasteryOverview(projectId);
      } catch {
        // best-effort — the zero-state UI below still renders fine
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const materials = (await materialsPromise) as Array<{ id: string; filename: string }>;

  return (
    <div className="page-enter">
      {error || !overview ? (
        <Alert>{error ?? "Failed to load mastery"}</Alert>
      ) : (
        <MasteryClient
          entries={overview.entries}
          summary={overview.summary}
          materials={materials.map((m) => ({ id: m.id, filename: m.filename }))}
          projectId={projectId}
          initialExpandedId={conceptId}
        />
      )}

      <p className="mt-6 text-xs text-stone-400">
        <Link href={`/projects/${projectId}/growth`} className="text-stone-800 hover:text-stone-900">
          View growth trends →
        </Link>
        <span className="mx-2" aria-hidden>
          ·
        </span>
        <Link href={`/projects/${projectId}/analytics`} className="text-stone-800 hover:text-stone-900">
          View analytics →
        </Link>
      </p>
    </div>
  );
}
