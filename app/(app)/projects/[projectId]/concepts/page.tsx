import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { notFound } from "next/navigation";
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

  return (
    <div className="page-enter">
      <p className="mb-4 text-sm text-stone-500">
        Concepts index from your materials, grouped by source. Tap any row to expand its sub-concepts.
      </p>
      <ConceptsClient projectId={projectId} />
    </div>
  );
}
