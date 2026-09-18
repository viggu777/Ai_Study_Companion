import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { getMasteryOverview } from "@/services/mastery.service";
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
