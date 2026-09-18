import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { notFound } from "next/navigation";
import FlashcardsClient from "./FlashcardsClient";

export default async function FlashcardsPage({
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
      <p className="mb-4 text-sm text-stone-500">Flashcards — weakest concepts first, generated from your materials.</p>
      <div className="w-full">
        <FlashcardsClient projectId={projectId} />
      </div>
    </div>
  );
}
