import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { displayNameOf } from "@/components/avatar";
import Link from "next/link";
import { listSpaces } from "@/services/project.service";
import { getGlobalAnalytics } from "@/services/analytics.service";
import { getDashboardData, type DashboardData } from "@/services/dashboard.service";
import { ArrowRightIcon, ChatIcon, FolderIcon, PlusIcon, QuizIcon, SparkIcon, TargetIcon, TrendUpIcon } from "@/components/icons";
import { Badge, Card, EmptyState, LinkButton, Stat } from "@/components/ui";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const name = displayNameOf(user);
  // Independent queries — start together so DB round-trips overlap.
  const spacesPromise = listSpaces();
  const globalPromise = getGlobalAnalytics();
  const dashboardPromise: Promise<DashboardData | null> = getDashboardData().catch(() => null);
  const spaces = await spacesPromise;

  let global: Awaited<ReturnType<typeof getGlobalAnalytics>> | null = null;
  let globalError: string | null = null;
  try {
    global = await globalPromise;
  } catch (e) {
    globalError = e instanceof Error ? e.message : String(e);
  }

  const dashboard = await dashboardPromise;
  const continueLearning = dashboard?.continueLearning ?? null;
  const recentProjects = dashboard?.recentProjects ?? [];
  const attentionItems = dashboard?.attentionItems ?? [];
  const nextActions = dashboard?.nextActions ?? [];
  const hasProjects = spaces.length > 0 || recentProjects.length > 0;

  return (
    <div className="page-enter">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
        Welcome back, {name}
      </h1>
      <p className="mb-6 mt-1 text-sm text-stone-500">Where you were, how you are doing, and what to do next.</p>

      {/* 1. Continue Learning — most recent/relevant project from real activity */}
      <section aria-label="Continue learning">
        {continueLearning ? (
          <Card className="border-sky-600/20 bg-sky-600/[0.04] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-600 text-white">
                <ArrowRightIcon className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                  Continue learning
                </p>
                <h2 className="truncate text-lg font-semibold tracking-tight text-stone-900">
                  {continueLearning.name}
                </h2>
                <p className="mt-0.5 text-xs text-stone-500">
                  {continueLearning.spaceName ? `${continueLearning.spaceName} · ` : ""}
                  Last activity {formatDate(continueLearning.lastActivityAt)}
                  {" · "}
                  {continueLearning.materialsCount} materials · {continueLearning.conceptsCount} concepts
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <LinkButton href={`/projects/${continueLearning.id}`} size="sm">
                Continue
                <ArrowRightIcon className="h-4 w-4" />
              </LinkButton>
              <LinkButton href={`/projects/${continueLearning.id}/tutor`} variant="secondary" size="sm">
                <ChatIcon className="h-4 w-4" />
                Ask Tutor
              </LinkButton>
              <LinkButton href={`/projects/${continueLearning.id}/quiz`} variant="secondary" size="sm">
                <QuizIcon className="h-4 w-4" />
                Take Quiz
              </LinkButton>
            </div>
          </Card>
        ) : (
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <SparkIcon className="h-4 w-4 text-stone-800" />
              <h2 className="text-sm font-semibold text-stone-900">Continue learning</h2>
            </div>
            <p className="mt-2 text-sm text-stone-500">
              Create a space and your first project to start learning — your most recent project will appear here.
            </p>
            <div className="mt-3">
              <LinkButton href="/spaces/new" size="sm">
                <PlusIcon className="h-4 w-4" />
                Create a Space
              </LinkButton>
            </div>
          </Card>
        )}
      </section>

      {/* 2. Recent Projects — real projects with metadata + direct navigation */}
      <section aria-label="Recent projects" className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-stone-500">
            Recent Projects{" "}
            {recentProjects.length > 0 && (
              <span className="tnum ml-1 font-normal normal-case tracking-normal text-stone-400">
                {recentProjects.length} shown
              </span>
            )}
          </h2>
        </div>
        {recentProjects.length === 0 ? (
          <EmptyState
            icon={<FolderIcon className="h-5 w-5" />}
            title={hasProjects ? "No recent projects yet" : "No projects yet"}
            description={
              hasProjects
                ? "Your projects will appear here once they are created."
                : "Projects live inside spaces. Create a space, then add a project with a learning goal."
            }
            action={
              <LinkButton href="/spaces/new">
                <PlusIcon className="h-4 w-4" />
                Create a Space
              </LinkButton>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {recentProjects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                prefetch
                className="group rounded-xl border border-stone-200 bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                    <FolderIcon className="h-[18px] w-[18px]" />
                  </span>
                  <ArrowRightIcon className="h-4 w-4 shrink-0 text-stone-300 transition-all group-hover:translate-x-0.5 group-hover:text-stone-800" />
                </div>
                <h3 className="mt-3 truncate font-semibold tracking-tight text-stone-900" title={project.name}>
                  {project.name}
                </h3>
                {project.description ? (
                  <p className="mt-1 line-clamp-2 text-sm text-stone-500">{project.description}</p>
                ) : project.learning_goal ? (
                  <p className="mt-1 line-clamp-2 text-sm text-stone-500">Goal: {project.learning_goal}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {project.spaceName && <Badge tone="neutral">{project.spaceName}</Badge>}
                  <Badge tone="accent" className="tnum">
                    {project.materialsCount} materials
                  </Badge>
                  <Badge tone="accent" className="tnum">
                    {project.conceptsCount} concepts
                  </Badge>
                </div>
                <p className="mt-3 text-xs text-stone-400">
                  {project.lastActivityAt
                    ? `Active ${formatDate(project.lastActivityAt)}`
                    : `Created ${formatDate(project.created_at)}`}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 3. Overall Progress — learning outcomes only (infra stats live in /admin) */}
      <section aria-label="Overall progress" className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-stone-500">
          Overall Progress
        </h2>
        {globalError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
            {globalError}
          </div>
        ) : global ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Stat
                label="Projects"
                value={global.totalProjects}
                sub={`${global.activeProjects} active in the last ${global.activeWindowDays} days`}
                icon={<FolderIcon className="h-[18px] w-[18px]" />}
              />
              <Stat
                label="Quizzes taken"
                value={global.totalQuizAttempts}
                sub={`${global.totalQuestionsAnswered} questions answered`}
                icon={<QuizIcon className="h-[18px] w-[18px]" />}
              />
              <Stat
                label="Tutor conversations"
                value={global.totalTutorInteractions}
                sub="Questions explained from your materials"
                icon={<ChatIcon className="h-[18px] w-[18px]" />}
              />
              <Stat
                label="Average mastery"
                value={
                  global.avgMastery !== null ? `${Math.round(global.avgMastery)}%` : "—"
                }
                sub={`Across ${global.totalConcepts} concepts`}
                icon={<TargetIcon className="h-[18px] w-[18px]" />}
              />
              <Stat
                label="Needs attention"
                value={attentionItems.length}
                sub={
                  attentionItems.length > 0
                    ? "Weak concepts to review next"
                    : "Nothing weak right now"
                }
                icon={<TrendUpIcon className="h-[18px] w-[18px]" />}
              />
              <Stat
                label="Next actions"
                value={nextActions.length}
                sub={
                  nextActions.length > 0
                    ? "Active recommendations waiting"
                    : "Complete a quiz to get guidance"
                }
                icon={<SparkIcon className="h-[18px] w-[18px]" />}
              />
            </div>

            <Card className="p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-stone-900">Learning momentum</h3>
                <span className="text-xs text-stone-400">
                  {global.activeProjects > 0
                    ? `${global.activeProjects} project${global.activeProjects === 1 ? "" : "s"} active this week`
                    : "Study this week to build momentum"}
                </span>
              </div>
              {hasProjects ? (
                <div className="flex flex-wrap gap-2">
                  <Badge tone="accent" className="tnum">
                    {global.totalConcepts} concepts tracked
                  </Badge>
                  <Badge tone={attentionItems.length > 0 ? "danger" : "neutral"} className="tnum">
                    {attentionItems.length} need attention
                  </Badge>
                  <Badge tone="neutral" className="tnum">
                    {nextActions.length} next actions
                  </Badge>
                  {continueLearning && (
                    <Badge tone="neutral" className="tnum">
                      Last active {formatDate(continueLearning.lastActivityAt)}
                    </Badge>
                  )}
                </div>
              ) : (
                <p className="text-sm text-stone-500">
                  Create a space and project, then upload a PDF to start tracking progress.
                </p>
              )}
            </Card>
          </div>
        ) : null}
      </section>

      {/* 4. Areas Requiring Attention — weak concepts from existing mastery/growth logic */}
      <section aria-label="Areas requiring attention" className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-stone-500">
          Areas Requiring Attention
        </h2>
        {!hasProjects ? (
          <Card className="p-5">
            <p className="text-sm text-stone-500">
              Weak concepts will appear here once you have projects, materials, and quiz activity.
            </p>
          </Card>
        ) : attentionItems.length === 0 ? (
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <TrendUpIcon className="h-4 w-4 text-stone-800" />
              <h3 className="text-sm font-semibold text-stone-900">Nothing needs attention right now</h3>
            </div>
            <p className="mt-2 text-sm text-stone-500">
              {dashboard === null
                ? "Attention data is temporarily unavailable — your projects and progress above are unaffected."
                : "No weak concepts detected. Take a quiz to generate fresh mastery evidence."}
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-stone-100 p-0">
            {attentionItems.map((item) => (
              <div key={`${item.projectId}-${item.conceptId}`} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-stone-900" title={item.conceptName}>
                      {item.conceptName}
                    </p>
                    <Badge tone={item.trend === "REQUIRES_ATTENTION" ? "danger" : "neutral"}>{item.trend}</Badge>
                    <Badge tone="neutral" className="tnum">
                      {item.score !== null ? `${Math.round(item.score)}/100` : "untested"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">
                    In{" "}
                    <Link href={`/projects/${item.projectId}`} className="font-medium text-stone-700 hover:text-stone-900">
                      {item.projectName}
                    </Link>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-medium">
                  <Link
                    href={`/projects/${item.projectId}/mastery?concept=${encodeURIComponent(item.conceptId)}`}
                    className="text-sky-700 hover:text-sky-800"
                  >
                    View mastery →
                  </Link>
                  <Link
                    href={`/projects/${item.projectId}/tutor?q=${encodeURIComponent(`Explain "${item.conceptName}" simply using my study material`)}`}
                    className="text-sky-700 hover:text-sky-800"
                  >
                    Ask Tutor →
                  </Link>
                  <Link href={`/projects/${item.projectId}/quiz`} className="text-sky-700 hover:text-sky-800">
                    Practice →
                  </Link>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* 5. Recommended Next Action — real ACTIVE recommendations, never invented */}
      <section aria-label="Recommended next action" className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-stone-500">
          Recommended Next Action
        </h2>
        {!hasProjects ? (
          <Card className="p-5">
            <p className="text-sm text-stone-500">
              Recommendations will appear here once you have learning activity.
            </p>
          </Card>
        ) : nextActions.length === 0 ? (
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <SparkIcon className="h-4 w-4 text-stone-800" />
              <h3 className="text-sm font-semibold text-stone-900">No active recommendations yet</h3>
            </div>
            <p className="mt-2 text-sm text-stone-500">
              {dashboard === null
                ? "Recommendations are temporarily unavailable."
                : "Complete a quiz — the system generates targeted recommendations when weak concepts are detected."}
            </p>
            {continueLearning && (
              <div className="mt-3">
                <LinkButton href={`/projects/${continueLearning.id}/quiz`} variant="secondary" size="sm">
                  <QuizIcon className="h-4 w-4" />
                  Take a Quiz
                </LinkButton>
              </div>
            )}
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {nextActions.map((rec) => (
              <Card key={rec.recommendationId} className="flex flex-col p-5">
                <div className="flex items-center gap-2">
                  <SparkIcon className="h-4 w-4 shrink-0 text-stone-800" />
                  <p className="truncate text-xs text-stone-500" title={rec.projectName}>
                    {rec.projectName}
                  </p>
                </div>
                <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-stone-900">{rec.title}</h3>
                {rec.action_items.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {rec.action_items.slice(0, 3).map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] text-stone-600">
                        <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-sky-600" />
                        <span className="line-clamp-2">{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-3 border-t border-stone-100 pt-3 text-xs font-medium">
                  <Link href={`/projects/${rec.projectId}/recommendations`} className="text-sky-700 hover:text-sky-800">
                    View all →
                  </Link>
                  <Link href={`/projects/${rec.projectId}`} className="text-stone-600 hover:text-stone-900">
                    Open project →
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Spaces — retained for navigation (existing behavior preserved) */}
      <section aria-label="Spaces" className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-stone-500">
            Your Spaces <span className="tnum ml-1 font-normal normal-case tracking-normal text-stone-400">{spaces.length} total</span>
          </h2>
          <LinkButton href="/spaces/new" size="sm">
            <PlusIcon className="h-4 w-4" />
            New Space
          </LinkButton>
        </div>
        {spaces.length === 0 ? (
          <EmptyState
            icon={<FolderIcon className="h-5 w-5" />}
            title="No spaces yet"
            description="Spaces group related projects. Create your first space to start learning."
            action={
              <LinkButton href="/spaces/new">
                <PlusIcon className="h-4 w-4" />
                Create a Space
              </LinkButton>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {spaces.map((space) => (
              <Link
                key={space.id}
                href={`/spaces/${space.id}`}
                prefetch
                className="group rounded-xl border border-stone-200 bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                    <FolderIcon className="h-[18px] w-[18px]" />
                  </span>
                  <ArrowRightIcon className="h-4 w-4 shrink-0 text-stone-300 transition-all group-hover:translate-x-0.5 group-hover:text-stone-800" />
                </div>
                <h3 className="mt-3 font-semibold tracking-tight text-stone-900">{space.name}</h3>
                {space.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-stone-500">{space.description}</p>
                )}
                <p className="mt-3 text-xs text-stone-400">
                  Created {new Date(space.created_at).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
