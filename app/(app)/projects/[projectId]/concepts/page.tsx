import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { listConceptsWithMeta, type ConceptWithMeta } from "@/services/concept.service";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui";
import ConceptsClient from "./ConceptsClient";

export default async function ConceptsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await getCurrentUser();
  const project = await getProject(projectId);
  if (!project) notFound();

  // Server-rendered: the page paints instantly with data (no client-side fetch
  // on mount, no skeleton flash when navigating back — Next.js also caches the
  // RSC payload for back/forward visits). The client revalidates silently.
  let concepts: ConceptWithMeta[] = [];
  let error: string | null = null;
  try {
    concepts = await listConceptsWithMeta(projectId);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="page-enter">
      <p className="mb-4 text-sm text-stone-500">
        Concepts index from your materials, grouped by source. Tap any card to expand its breakdown and study actions.
      </p>
      {error ? (
        <Alert>{error}</Alert>
      ) : (
        <ConceptsClient projectId={projectId} initialConcepts={concepts} />
      )}
    </div>
  );
}
