import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { notFound } from "next/navigation";
import RecommendationClient from "./RecommendationClient";

export default async function RecommendationsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await getCurrentUser();
  const project = await getProject(projectId);
  if (!project) notFound();

  return (
    <div>
      <p className="mb-4 text-sm text-stone-500">Actionable next steps — each names a specific concept and material/page when available.</p>
      <RecommendationClient projectId={projectId} />
    </div>
  );
}
