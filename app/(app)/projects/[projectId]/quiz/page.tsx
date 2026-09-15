import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { notFound } from "next/navigation";
import QuizClient from "./QuizClient";

export default async function QuizPage({
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
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Quiz — {project.name}</h1>
        <p className="text-sm text-stone-600">Adaptive quiz — weaker and recently-missed concepts appear more often</p>
      </div>
      <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <QuizClient projectId={projectId} />
      </div>
    </div>
  );
}
