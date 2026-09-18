import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { notFound } from "next/navigation";
import PracticeClient from "./PracticeClient";

export default async function PracticePage({
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
  // Deep-link from the Tutor setup dialog: ?count=N&level=L&start=1
  // pre-selects options and auto-starts the assignment (validated client-side).
  const sp = (await searchParams) ?? {};
  const countRaw = Number(sp.count);
  const initialCount = Number.isFinite(countRaw) ? Math.floor(countRaw) : undefined;
  const levelRaw = (sp.level ?? "").toUpperCase();
  const initialLevel =
    levelRaw === "EASY" || levelRaw === "MEDIUM" || levelRaw === "HARD" || levelRaw === "MIXED"
      ? levelRaw
      : undefined;
  const autostart = sp.start === "1";

  return (
    <div>
      <p className="mb-4 text-sm text-stone-500">
        Deep practice — explain, reason, and apply. Unlike Quiz (fast assessment), Practice collects evidence about what you actually understand.
      </p>
      <div className="w-full">
        <PracticeClient
          projectId={projectId}
          initialCount={initialCount}
          initialLevel={initialLevel as "MIXED" | "EASY" | "MEDIUM" | "HARD" | undefined}
          autostart={autostart}
        />
      </div>
    </div>
  );
}
