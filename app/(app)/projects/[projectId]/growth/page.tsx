import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { getGrowthAnalysis } from "@/services/growth.service";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Alert, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { TrendUpIcon } from "@/components/icons";
import GrowthClient from "./GrowthClient";

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

  return (
    <div className="page-enter">
      <PageHeader
        title="Growth"
        description="How your understanding changes as you complete quizzes and practice. Compares your two most recent results per concept."
        actions={
          growth.length > 0 ? (
            <LinkButton href={`/projects/${projectId}/recommendations`} variant="secondary" size="sm">
              View recommendations
            </LinkButton>
          ) : undefined
        }
      />

      {error ? (
        <Alert>{error}</Alert>
      ) : growth.length === 0 ? (
        <EmptyState
          icon={<TrendUpIcon className="h-5 w-5" />}
          title="No growth to show yet"
          description="Upload study material and complete a quiz — your progress trend will appear here after your first results."
          action={
            <LinkButton href={`/projects/${projectId}/materials`} size="sm">
              Upload material
            </LinkButton>
          }
        />
      ) : (
        <>
          <GrowthClient entries={growth} projectId={projectId} />
          <p className="mt-4 text-xs text-stone-400">
            A concept counts as improving or needing attention when it moves more than a few
            points between results.{" "}
            <Link href={`/projects/${projectId}/mastery`} className="font-medium text-stone-600 hover:text-stone-900">
              View mastery →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
