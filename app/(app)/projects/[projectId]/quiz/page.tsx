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
      <p className="mb-4 text-sm text-stone-500">Adaptive quiz — weaker and recently-missed concepts appear more often.</p>
      <div className="w-full">
        <QuizClient projectId={projectId} />
      </div>
    </div>
  );
}
