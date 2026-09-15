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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Recommendations — {project.name}</h1>
        <p className="text-sm text-stone-600">Actionable next steps — each names a specific concept and material/page when available</p>
      </div>
      <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <RecommendationClient projectId={projectId} />
      </div>
    </div>
  );
}
