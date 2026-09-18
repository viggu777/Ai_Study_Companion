import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import Link from "next/link";
import { getProject, getSpace } from "@/services/project.service";
import { listActiveRecommendations } from "@/services/recommendation.service";
import { getGrowthAnalysis } from "@/services/growth.service";
import { listMaterials } from "@/services/material.service";
import { notFound } from "next/navigation";
import { ArrowRightIcon, BookIcon, CardsIcon, ChartIcon, ChatIcon, ConceptsIcon, PracticeIcon, QuizIcon, SparkIcon, TargetIcon, TrendUpIcon } from "@/components/icons";
import { Badge, Card } from "@/components/ui";
import RecommendedNextAction, { type RecommendedConcept } from "@/components/RecommendedNextAction";

const features = [
  { href: "materials", label: "Materials", text: "Upload and manage PDF materials", icon: BookIcon },
  { href: "tutor", label: "Tutor", text: "Ask questions about your materials", icon: ChatIcon },
  { href: "flashcards", label: "Flashcards", text: "Review weakest concepts as flip-cards", icon: CardsIcon },
  { href: "concepts", label: "Concepts", text: "Browse concepts and sub-concepts", icon: ConceptsIcon },
  { href: "quiz", label: "Quiz", text: "Fast assessment — get the answer right", icon: QuizIcon },
  { href: "practice", label: "Practice", text: "Deep learning — show what you understand", icon: PracticeIcon },
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
  const recsPromise = listActiveRecommendations(projectId, 3).catch(() => []);
  // Same source + ranking as the Mastery page: weakest-first (untested counts as 0).
  const growthPromise = getGrowthAnalysis(projectId).catch(() => []);
  const materialsPromise = listMaterials(projectId).catch(() => []);
  const project = await projectPromise;
  if (!project) notFound();

  // Parent space for the back-link (best-effort — the link works with just
  // the id; only the label falls back).
  const space = await getSpace(project.space_id).catch(() => null);

  // ACTIVE recommendations for dashboard card (best-effort)
  const dashboardRecs = await recsPromise;
  const growth = await growthPromise;
  const materials = await materialsPromise;
  const materialNameById = new Map(
    (materials as Array<{ id: string; filename: string }>).map((m) => [m.id, m.filename])
  );
  const recommendedConcepts: RecommendedConcept[] = [...growth]
    .sort((a, b) => (a.currentScore ?? -1) - (b.currentScore ?? -1))
    .map((g) => ({
      id: g.conceptId,
      name: g.conceptName,
      description: g.description,
      score: g.currentScore,
      trend: g.trend,
      sourceMaterialId: g.sourceMaterialId,
      materialName: g.sourceMaterialId ? (materialNameById.get(g.sourceMaterialId) ?? null) : null,
    }));

  // Learning-loop state — all derived from the same three fetches above.
  // No new queries, no duplicated mastery/recommendation logic.
  const matRows = materials as Array<{ status: string }>;
  const readyCount = matRows.filter((m) => m.status === "READY").length;
  const processingCount = matRows.filter((m) => m.status === "QUEUED" || m.status === "PROCESSING").length;
  const failedCount = matRows.filter((m) => m.status === "FAILED").length;
  const weakConcepts = [...growth]
    .filter((g) => g.trend === "REQUIRES_ATTENTION" || (g.currentScore ?? 0) < 60)
    .sort((a, b) => (a.currentScore ?? -1) - (b.currentScore ?? -1))
    .slice(0, 3);
  const improvingCount = growth.filter((g) => g.trend === "IMPROVING").length;

  // Ordered learning loop: Material → Tutor → Quiz → Practice → Mastery → Growth → Recommendation.
  const loopSteps = [
    {
      n: 1,
      href: "materials",
      label: "Materials",
      stage: "Upload",
      status:
        matRows.length === 0
          ? "No PDFs yet — upload"
          : failedCount > 0
            ? `${readyCount} ready · ${failedCount} failed`
            : processingCount > 0
              ? `${readyCount} ready · ${processingCount} processing`
              : `${readyCount} ready`,
    },
    { n: 2, href: "tutor", label: "Tutor", stage: "Learn", status: "Grounded answers + citations" },
    { n: 3, href: "quiz", label: "Quiz", stage: "Assess", status: "Fast check · weakest first" },
    { n: 4, href: "practice", label: "Practice", stage: "Deepen", status: "Explain · evidence first" },
    {
      n: 5,
      href: "mastery",
      label: "Mastery",
      stage: "Measure",
      status:
        growth.length === 0
          ? "Quiz or practice to measure"
          : weakConcepts.length > 0
            ? `${weakConcepts.length} need${weakConcepts.length === 1 ? "s" : ""} attention`
            : "All concepts on track",
    },
    {
      n: 6,
      href: "growth",
      label: "Growth",
      stage: "Track",
      status:
        growth.length === 0
          ? "No history yet"
          : improvingCount > 0
            ? `${improvingCount} improving`
            : "Stable so far",
    },
    {
      n: 7,
      href: "recommendations",
      label: "Recommendations",
      stage: "Next step",
      status:
        dashboardRecs.length === 0 ? "Appear when concepts weaken" : `${dashboardRecs.length} active`,
    },
  ] as const;

  return (
    <div className="page-enter">
      <Link
        href={`/spaces/${project.space_id}`}
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-stone-100 px-2.5 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-sky-600/10 hover:text-sky-800"
      >
        <span aria-hidden>←</span> Back to {space?.name ?? "space"}
      </Link>
      {(project.description || project.learning_goal) && (
        <div className="mb-6 text-sm text-stone-500">
          {project.description && <span className="block">{project.description}</span>}
          {project.learning_goal && (
            <span className="mt-1 block">
              <span className="font-medium text-stone-600">Goal:</span> {project.learning_goal}
            </span>
          )}
        </div>
      )}

      {/* Learning loop — the PRD loop made visible, with live per-stage state */}
      <section aria-label="Your learning loop" className="mb-6">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
          Your learning loop
        </h2>
        <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
          {loopSteps.map((step) => (
            <li key={step.href}>
              <Link
                href={`/projects/${projectId}/${step.href}`}
                prefetch
                className="group flex h-full flex-col rounded-xl border border-stone-200 bg-white p-3.5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
              >
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="tnum flex h-5 w-5 items-center justify-center rounded-full bg-sky-600/10 text-[11px] font-semibold text-sky-700"
                  >
                    {step.n}
                  </span>
                  <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                    {step.stage}
                  </span>
                </span>
                <span className="mt-1.5 flex items-center gap-1 text-sm font-semibold text-stone-900">
                  {step.label}
                  <ArrowRightIcon className="h-3.5 w-3.5 text-stone-300 transition-all group-hover:translate-x-0.5 group-hover:text-stone-800" />
                </span>
                <span className="mt-0.5 line-clamp-2 text-xs text-stone-500">{step.status}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {/* Needs attention — weakest concepts with one-tap learn/practice links */}
      <section aria-label="Needs attention" className="mb-6">
        {weakConcepts.length > 0 ? (
          <Card className="border-amber-200 bg-amber-50/60 p-5">
            <div className="flex items-center gap-2">
              <TargetIcon className="h-4 w-4 text-amber-700" />
              <h2 className="text-sm font-semibold text-stone-900">Needs attention</h2>
              <Link
                href={`/projects/${projectId}/mastery`}
                prefetch
                className="ml-auto text-xs font-medium text-stone-800 hover:text-stone-900"
              >
                View all →
              </Link>
            </div>
            <ul className="mt-3 space-y-2.5">
              {weakConcepts.map((c) => (
                <li
                  key={c.conceptId}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-stone-200 bg-white px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-900" title={c.conceptName}>
                    {c.conceptName}
                  </span>
                  <Badge tone={c.trend === "REQUIRES_ATTENTION" ? "danger" : "neutral"}>
                    {c.currentScore !== null ? `${Math.round(c.currentScore)}/100` : "untested"}
                  </Badge>
                  <span className="flex gap-2 text-xs font-medium">
                    <Link
                      href={`/projects/${projectId}/tutor?q=${encodeURIComponent(`Explain "${c.conceptName}" simply using my study material`)}`}
                      className="text-sky-700 hover:text-sky-800"
                    >
                      Ask Tutor
                    </Link>
                    <Link href={`/projects/${projectId}/quiz`} className="text-sky-700 hover:text-sky-800">
                      Quiz
                    </Link>
                    <Link href={`/projects/${projectId}/practice`} className="text-sky-700 hover:text-sky-800">
                      Practice
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : growth.length > 0 ? (
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <TrendUpIcon className="h-4 w-4 text-stone-800" />
              <h2 className="text-sm font-semibold text-stone-900">On track</h2>
              <Link
                href={`/projects/${projectId}/growth`}
                prefetch
                className="ml-auto text-xs font-medium text-stone-800 hover:text-stone-900"
              >
                View growth →
              </Link>
            </div>
            <p className="mt-2 text-sm text-stone-500">
              No concept needs attention right now
              {improvingCount > 0 ? ` — ${improvingCount} improving.` : "."} Keep momentum with
              the recommended next action below.
            </p>
          </Card>
        ) : (
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <BookIcon className="h-4 w-4 text-stone-800" />
              <h2 className="text-sm font-semibold text-stone-900">Get started</h2>
            </div>
            <p className="mt-2 text-sm text-stone-500">
              {matRows.length === 0 ? (
                <>
                  Upload a PDF to build your knowledge base, then ask the Tutor and take a
                  quiz — weak spots will surface here.{" "}
                  <Link href={`/projects/${projectId}/materials`} className="font-medium text-sky-700 hover:text-sky-800">
                    Upload material →
                  </Link>
                </>
              ) : (
                <>
                  {readyCount > 0 ? `${readyCount} material${readyCount === 1 ? "" : "s"} ready. ` : ""}
                  Take a quiz so mastery can be measured and weak spots surface here.{" "}
                  <Link href={`/projects/${projectId}/quiz`} className="font-medium text-sky-700 hover:text-sky-800">
                    Start quiz →
                  </Link>
                </>
              )}
            </p>
          </Card>
        )}
      </section>

      {dashboardRecs.length > 0 && (
        <Card className="mb-6 border-sky-600/10 bg-stone-100/50 p-5">
          <div className="flex items-center gap-2">
            <SparkIcon className="h-4 w-4 text-stone-800" />
            <h2 className="text-sm font-semibold text-stone-900">Active recommendations</h2>
            <Link
              href={`/projects/${projectId}/recommendations`}
              prefetch
              className="ml-auto text-xs font-medium text-stone-800 hover:text-stone-900"
            >
              View all →
            </Link>
          </div>
          <ul className="mt-3 space-y-2">
            {dashboardRecs.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-sky-600" />
                <Link
                  href={`/projects/${projectId}/recommendations`}
                  prefetch
                  className="text-stone-700 hover:text-stone-900 hover:underline"
                >
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
        Browse everything
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((item) => (
          <Link
            key={item.href}
            href={`/projects/${projectId}/${item.href}`}
            prefetch
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
          </Link>
        ))}
      </div>

      <RecommendedNextAction
        projectId={projectId}
        projectName={project.name}
        concepts={recommendedConcepts}
        activeRecommendation={dashboardRecs[0] ?? null}
      />
    </div>
  );
}
