import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { getDb } from "@/lib/db/supabase";
import { notFound } from "next/navigation";
import { ArrowRightIcon, BookIcon, ChartIcon, ChatIcon, QuizIcon, SparkIcon, TargetIcon, TrendUpIcon } from "@/components/icons";
import { Card, PageHeader } from "@/components/ui";

const features = [
  { href: "materials", label: "Materials", text: "Upload and manage PDF materials", icon: BookIcon },
  { href: "tutor", label: "Tutor", text: "Ask questions about your materials", icon: ChatIcon },
  { href: "quiz", label: "Quiz", text: "Test yourself with adaptive quizzes", icon: QuizIcon },
  { href: "mastery", label: "Mastery", text: "Track concept mastery over time", icon: TargetIcon },
  { href: "growth", label: "Growth", text: "View learning growth analysis", icon: TrendUpIcon },
  { href: "analytics", label: "Analytics", text: "View project analytics", icon: ChartIcon },
  { href: "recommendations", label: "Recommendations", text: "Actionable next steps for weak concepts", icon: SparkIcon },
] as const;

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await getCurrentUser();
  // Independent queries — start together so DB round-trips overlap.
  const projectPromise = getProject(projectId);
  const recsPromise = (async () => {
    try {
      const db = await getDb();
      const { data } = await db
        .from("recommendations")
        .select("id, title, action_items, status, created_at")
        .eq("project_id", projectId)
        .eq("status", "ACTIVE")
        .order("created_at", { ascending: false })
        .limit(3);
      return (data ?? []) as Array<{ id: string; title: string; action_items: string[]; status: string; created_at: string }>;
    } catch {
      return [];
    }
  })();
  const project = await projectPromise;
  if (!project) notFound();

  // ACTIVE recommendations for dashboard card (best-effort)
  const dashboardRecs = await recsPromise;

  return (
    <div className="page-enter">
      <PageHeader
        title={project.name}
        description={
          <>
            {project.description && <span className="block">{project.description}</span>}
            {project.learning_goal && (
              <span className="mt-1 block">
                <span className="font-medium text-stone-600">Goal:</span> {project.learning_goal}
              </span>
            )}
          </>
        }
      />

      {dashboardRecs.length > 0 && (
        <Card className="mb-6 border-sky-600/10 bg-stone-100/50 p-5">
          <div className="flex items-center gap-2">
            <SparkIcon className="h-4 w-4 text-stone-800" />
            <h2 className="text-sm font-semibold text-stone-900">Active recommendations</h2>
            <a
              href={`/projects/${projectId}/recommendations`}
              className="ml-auto text-xs font-medium text-stone-800 hover:text-stone-900"
            >
              View all →
            </a>
          </div>
          <ul className="mt-3 space-y-2">
            {dashboardRecs.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-sky-600" />
                <span className="text-stone-700">{r.title}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((item) => (
          <a
            key={item.href}
            href={`/projects/${projectId}/${item.href}`}
            className="group rounded-xl border border-stone-200 bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
          >
            <div className="flex items-start justify-between">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                <item.icon className="h-[18px] w-[18px]" />
              </span>
              <ArrowRightIcon className="h-4 w-4 text-stone-300 transition-all group-hover:translate-x-0.5 group-hover:text-stone-800" />
            </div>
            <h3 className="mt-3 font-semibold tracking-tight text-stone-900">{item.label}</h3>
            <p className="mt-1 text-sm text-stone-500">{item.text}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
