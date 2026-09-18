import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { getGrowthAnalysis } from "@/services/growth.service";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Alert, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { QuizIcon, TrendUpIcon } from "@/components/icons";
import GrowthClient from "./GrowthClient";

export default async function GrowthPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await getCurrentUser();
  // Independent queries — start together so DB round-trips overlap.
  const projectPromise = getProject(projectId);
  const growthPromise = getGrowthAnalysis(projectId);
  const project = await projectPromise;
  if (!project) notFound();

  let growth: Awaited<ReturnType<typeof getGrowthAnalysis>> = [];
  let error: string | null = null;
  try {
    growth = await growthPromise;
    // Self-heal: a completed quiz that never reached the mastery worker leaves
    // every concept at 0-1 history rows, so Growth shows all-New zeros even
    // after 2 quizzes. If no concept has 2 results yet, replay missing quiz
    // mastery inline (idempotent, oldest-first) and re-read once.
    if (growth.length > 0 && growth.every((e) => e.historyCount < 2)) {
      try {
        const { backfillMissingQuizMastery } = await import("@/services/mastery.service");
        const healed = await backfillMissingQuizMastery(projectId, user.id, 10);
        if (healed.updated > 0) growth = await getGrowthAnalysis(projectId);
      } catch {
        // best-effort — the no-trend UI below still renders fine
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="page-enter">
      <PageHeader
        title="Growth"
        description="What improved, what needs attention, and what to do next. A trend compares your last two results per concept — quiz, practice, and flashcards all count."
        actions={
          <>
            <LinkButton href={`/projects/${projectId}/quiz`} variant="secondary" size="sm">
              <QuizIcon className="h-4 w-4" />
              Take a quiz
            </LinkButton>
            {growth.length > 0 && (
              <LinkButton href={`/projects/${projectId}/recommendations`} variant="secondary" size="sm">
                View recommendations
              </LinkButton>
            )}
          </>
        }
      />

      {error ? (
        <Alert>{error}</Alert>
      ) : growth.length === 0 ? (
        <EmptyState
          icon={<TrendUpIcon className="h-5 w-5" />}
          title="No concepts to track yet"
          description="Upload study material to create concepts, then complete a quiz — your improvement and attention signals will appear here after two results per concept."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href={`/projects/${projectId}/materials`} size="sm">
                Upload material
              </LinkButton>
              <LinkButton href={`/projects/${projectId}/tutor`} variant="secondary" size="sm">
                Ask the Tutor
              </LinkButton>
            </div>
          }
        />
      ) : (
        <>
          <GrowthClient entries={growth} projectId={projectId} />
          <p className="mt-4 text-xs text-stone-400">
            Improving or needing attention means moving more than 5 points between your last two results.{" "}
            <Link href={`/projects/${projectId}/mastery`} className="font-medium text-stone-600 hover:text-stone-900">
              View mastery →
            </Link>{" "}
            ·{" "}
            <Link href={`/projects/${projectId}/analytics`} className="font-medium text-stone-600 hover:text-stone-900">
              View analytics →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
