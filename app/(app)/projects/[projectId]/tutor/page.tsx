import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { notFound } from "next/navigation";
import TutorClient from "./TutorClient";

export default async function TutorPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{ q?: string }>;
}) {
  const { projectId } = await params;
  await getCurrentUser();
  const project = await getProject(projectId);
  if (!project) notFound();
  const initialQuestion = (await searchParams)?.q?.trim().slice(0, 500) || null;

  return (
    <div className="-mx-4 -my-6 sm:-mx-6">
      <TutorClient projectId={projectId} initialQuestion={initialQuestion} />
    </div>
  );
}
