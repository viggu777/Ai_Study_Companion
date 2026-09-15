import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { notFound } from "next/navigation";
import TutorClient from "./TutorClient";

export default async function TutorPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await getCurrentUser();
  const project = await getProject(projectId);
  if (!project) notFound();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Tutor — {project.name}</h1>
        <p className="text-sm text-stone-600">Grounded in your Project materials, with citations</p>
      </div>
      <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <TutorClient projectId={projectId} />
      </div>
    </div>
  );
}
