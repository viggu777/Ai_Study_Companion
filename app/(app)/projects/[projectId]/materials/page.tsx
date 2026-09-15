import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { listMaterials } from "@/services/material.service";
import { notFound } from "next/navigation";
import MaterialsClient from "./MaterialsClient";

export default async function MaterialsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await getCurrentUser();
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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Materials — {project.name}</h1>
        <p className="text-sm text-stone-600">Upload PDFs; processing is background (QUEUED → PROCESSING → READY)</p>
      </div>
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <MaterialsClient projectId={projectId} initialMaterials={initialMaterials} />
      </div>
    </div>
  );
}
