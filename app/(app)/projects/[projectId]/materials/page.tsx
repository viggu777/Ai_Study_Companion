import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { listMaterials } from "@/services/material.service";
import { notFound } from "next/navigation";
import MaterialsClient from "./MaterialsClient";

export default async function MaterialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{ material?: string }>;
}) {
  const { projectId } = await params;
  await getCurrentUser();
  const highlightId = (await searchParams)?.material?.trim() || null;
  // Independent queries — start together so DB round-trips overlap.
  const projectPromise = getProject(projectId);
  const materialsPromise = listMaterials(projectId);
  const project = await projectPromise;
  if (!project) notFound();

  // Initial server-side fetch for first paint; client will poll for updates
  let initialMaterials: Awaited<ReturnType<typeof listMaterials>> = [];
  try {
    initialMaterials = await materialsPromise;
  } catch {
    initialMaterials = [];
  }

  return (
    <div>
      <p className="mb-4 text-sm text-stone-500">Upload PDFs; processing is background (QUEUED → PROCESSING → READY).</p>
      <MaterialsClient projectId={projectId} initialMaterials={initialMaterials} initialHighlightId={highlightId} />
    </div>
  );
}
