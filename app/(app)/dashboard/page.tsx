import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { listSpaces } from "@/services/project.service";
import { getGlobalAnalytics } from "@/services/analytics.service";
import { ArrowRightIcon, ChartIcon, ChatIcon, FolderIcon, PlusIcon, QuizIcon, SparkIcon, TargetIcon } from "@/components/icons";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";

export default async function DashboardPage() {
  await getCurrentUser();
  // Independent queries — start together so DB round-trips overlap.
  const spacesPromise = listSpaces();
  const globalPromise = getGlobalAnalytics();
  const spaces = await spacesPromise;

  let global: Awaited<ReturnType<typeof getGlobalAnalytics>> | null = null;
  let globalError: string | null = null;
  try {
    global = await globalPromise;
  } catch (e) {
    globalError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="page-enter">
      <PageHeader
        title="Dashboard"
        description="Your spaces, projects and learning activity at a glance."
        actions={
          <LinkButton href="/spaces/new" size="sm">
            <PlusIcon className="h-4 w-4" />
            New Space
          </LinkButton>
        }
      />

      {/* Learning snapshot */}
      <section aria-label="Learning snapshot">
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
                label="Quiz attempts"
                value={global.totalQuizAttempts}
                sub={`${global.totalQuestionsAnswered} questions answered`}
                icon={<QuizIcon className="h-[18px] w-[18px]" />}
              />
              <Stat
                label="Tutor interactions"
                value={global.totalTutorInteractions}
                sub="Grounded answers from your materials"
                icon={<ChatIcon className="h-[18px] w-[18px]" />}
              />
              <Stat
                label="Average mastery"
                value={global.avgMastery !== null ? global.avgMastery.toFixed(1) : "—"}
                sub={`Across ${global.totalConcepts} concepts`}
                icon={<TargetIcon className="h-[18px] w-[18px]" />}
              />
              <Stat
                label="AI calls"
                value={global.aiUsage.totalCalls}
                sub={
                  global.aiUsage.errorRate !== null
                    ? `${(global.aiUsage.errorRate * 100).toFixed(1)}% error rate`
                    : "No errors recorded"
                }
                icon={<SparkIcon className="h-[18px] w-[18px]" />}
              />
              <Stat
                label="Avg AI latency"
                value={global.aiUsage.avgLatencyMs !== null ? `${global.aiUsage.avgLatencyMs}ms` : "—"}
                sub={
                  global.aiUsage.totalEstimatedCost !== null
                    ? `Est. cost $${global.aiUsage.totalEstimatedCost}`
                    : "Across all features"
                }
                icon={<ChartIcon className="h-[18px] w-[18px]" />}
              />
            </div>

            <Card className="p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-stone-900">AI usage by feature</h2>
                <span className="text-xs text-stone-400">Live from ai_operations</span>
              </div>
              {Object.keys(global.aiUsage.perFeature).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(global.aiUsage.perFeature).map(([feat, count]) => (
                    <Badge key={feat} tone="accent" className="tnum">
                      {feat} · {count}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-stone-500">No AI calls yet — try the Tutor or generate a quiz.</p>
              )}
            </Card>
          </div>
        ) : null}
      </section>

      {/* Spaces */}
      <section aria-label="Spaces" className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-stone-500">
            Your Spaces
          </h2>
          <span className="tnum text-xs text-stone-400">{spaces.length} total</span>
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
              <a
                key={space.id}
                href={`/spaces/${space.id}`}
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
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
