import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { notFound } from "next/navigation";
import PracticeClient from "./PracticeClient";

export default async function PracticePage({
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
      <p className="mb-4 text-sm text-stone-500">
        Deep practice — explain, reason, and apply. Unlike Quiz (fast assessment), Practice collects evidence about what you actually understand.
      </p>
      <div className="w-full">
        <PracticeClient projectId={projectId} />
      </div>
    </div>
  );
}
