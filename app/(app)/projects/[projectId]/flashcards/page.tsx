import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { notFound } from "next/navigation";
import { clampFlashcardLevel } from "@/ai/flashcards";
import FlashcardsClient from "./FlashcardsClient";

export default async function FlashcardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{ count?: string; level?: string; start?: string }>;
}) {
  const { projectId } = await params;
  await getCurrentUser();
  const project = await getProject(projectId);
  if (!project) notFound();
  // Deep-link from the Tutor setup dialog: ?count=N&level=L&start=1 pre-selects
  // the deck size + level and builds it automatically (validated client-side).
  const sp = (await searchParams) ?? {};
  const countRaw = Number(sp.count);
  const initialCount = Number.isFinite(countRaw) ? Math.floor(countRaw) : undefined;
  const initialLevel = typeof sp.level === "string" ? clampFlashcardLevel(sp.level) : undefined;
  const autostart = sp.start === "1";

  return (
    <div>
      <p className="mb-4 text-sm text-stone-500">Flashcards — pick concepts by material, set a level, study the deck.</p>
      <div className="w-full">
        <FlashcardsClient projectId={projectId} initialCount={initialCount} initialLevel={initialLevel} autostart={autostart} />
      </div>
    </div>
  );
}
