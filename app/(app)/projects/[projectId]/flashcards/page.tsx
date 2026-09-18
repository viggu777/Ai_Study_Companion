import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { notFound } from "next/navigation";
import FlashcardsClient from "./FlashcardsClient";

export default async function FlashcardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{ count?: string; start?: string }>;
}) {
  const { projectId } = await params;
  await getCurrentUser();
  const project = await getProject(projectId);
  if (!project) notFound();
  // Deep-link from the Tutor setup dialog: ?count=N&start=1 pre-selects the
  // deck size and builds it automatically (validated client-side).
  const sp = (await searchParams) ?? {};
  const countRaw = Number(sp.count);
  const initialCount = Number.isFinite(countRaw) ? Math.floor(countRaw) : undefined;
  const autostart = sp.start === "1";

  return (
    <div>
      <p className="mb-4 text-sm text-stone-500">Flashcards — weakest concepts first, generated from your materials.</p>
      <div className="w-full">
        <FlashcardsClient projectId={projectId} initialCount={initialCount} autostart={autostart} />
      </div>
    </div>
  );
}
