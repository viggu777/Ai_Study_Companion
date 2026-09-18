import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { getProjectAnalytics } from "@/services/analytics.service";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Alert, Badge, Card, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import {
  BookIcon,
  ChartIcon,
  ChatIcon,
  QuizIcon,
  SparkIcon,
  TargetIcon,
  TrendUpIcon,
} from "@/components/icons";

export default async function AnalyticsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await getCurrentUser();
  // Independent queries — start together so DB round-trips overlap.
  const projectPromise = getProject(projectId);
  const analyticsPromise = getProjectAnalytics(projectId);
  const project = await projectPromise;
  if (!project) notFound();

  let analytics: Awaited<ReturnType<typeof getProjectAnalytics>> | null = null;
  let error: string | null = null;
  try {
    analytics = await analyticsPromise;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="page-enter">
        <PageHeader
          title="Analytics"
          description="Your study activity, quiz performance and concept progress for this project."
        />
        <Alert>{error}</Alert>
      </div>
    );
  }

  const a = analytics!;
  const hasActivity =
    a.learningActivity.tutorSessions > 0 ||
    a.learningActivity.quizAttempts > 0 ||
    a.learningActivity.questionsAnswered > 0;
  const maxTrend = Math.max(
    1,
    ...a.assessment.accuracyOverTime.map((r) => r.count),
  );
  const topConcepts = [...a.mastery.perConcept]
    .sort((x, y) => (x.mastery ?? -1) - (y.mastery ?? -1))
    .slice(0, 8);

  return (
    <div className="page-enter">
      <PageHeader
        title="Analytics"
        description="How much you've studied, how well you're performing, and where your understanding stands."
        actions={
          <LinkButton href={`/projects/${projectId}/quiz`} variant="secondary" size="sm">
            <QuizIcon className="h-4 w-4" />
            Take a quiz
          </LinkButton>
        }
      />

      {!hasActivity && a.mastery.totalConcepts === 0 ? (
        <EmptyState
          icon={<ChartIcon className="h-5 w-5" />}
          title="No activity yet"
          description="Ask the Tutor a question or take your first quiz — your study insights will appear here."
          action={
            <LinkButton href={`/projects/${projectId}/tutor`} size="sm">
              <ChatIcon className="h-4 w-4" />
              Ask the Tutor
            </LinkButton>
          }
        />
      ) : (
        <div className="space-y-6">
          {/* Study activity */}
          <section aria-label="Study activity">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-stone-500">
              Study activity
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Tutor conversations"
                value={a.learningActivity.tutorSessions}
                sub={`${a.learningActivity.tutorMessagesSent} questions asked`}
                icon={<ChatIcon className="h-[18px] w-[18px]" />}
              />
              <Stat
                label="Quizzes taken"
                value={a.learningActivity.quizAttempts}
                sub={`${a.learningActivity.questionsAnswered} questions answered`}
                icon={<QuizIcon className="h-[18px] w-[18px]" />}
              />
              <Stat
                label="Average mastery"
                value={a.mastery.avgMastery !== null ? `${Math.round(a.mastery.avgMastery)}%` : "—"}
                sub={`Across ${a.mastery.totalConcepts} concepts`}
                icon={<TargetIcon className="h-[18px] w-[18px]" />}
              />
              <Stat
                label="Quiz accuracy"
                value={a.assessment.accuracy !== null ? `${Math.round(a.assessment.accuracy)}%` : "—"}
                sub={
                  a.assessment.totalAnswers > 0
                    ? `From ${a.assessment.totalAnswers} answers`
                    : "Take a quiz to measure"
                }
                icon={<TrendUpIcon className="h-[18px] w-[18px]" />}
              />
            </div>
          </section>

          {/* Performance */}
          <section aria-label="Quiz performance">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-stone-500">
              Quiz performance
            </h2>
            <Card className="p-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-[13px] font-medium text-stone-500">Average score</p>
                  <p className="tnum mt-1 text-2xl font-semibold tracking-tight text-stone-900">
                    {a.assessment.averageScore !== null ? Math.round(a.assessment.averageScore) : "—"}
                  </p>
                  <p className="mt-1 text-xs text-stone-400">Out of 100, all answers</p>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-stone-500">Written answers</p>
                  <p className="tnum mt-1 text-2xl font-semibold tracking-tight text-stone-900">
                    {a.assessment.averageOpenEndedScore !== null
                      ? Math.round(a.assessment.averageOpenEndedScore)
                      : "—"}
                  </p>
                  <p className="mt-1 text-xs text-stone-400">
                    {a.assessment.openEndedCount} written responses graded
                  </p>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-stone-500">Question mix</p>
                  <p className="mt-1 text-sm font-semibold text-stone-900">
                    {a.assessment.mcqCount} quick · {a.assessment.openEndedCount} written
                  </p>
                  <p className="mt-1 text-xs text-stone-400">Quick checks vs explanations</p>
                </div>
              </div>

              {a.assessment.accuracyOverTime.length > 0 ? (
                <div className="mt-5 border-t border-stone-100 pt-4">
                  <p className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-stone-400">
                    Accuracy over time
                  </p>
                  <div className="flex h-24 items-end gap-2" role="img" aria-label="Accuracy over time chart">
                    {a.assessment.accuracyOverTime.map((r) => {
                      const pct = r.accuracy ?? 0;
                      return (
                        <div key={r.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                          <div className="flex h-16 w-full items-end rounded-md bg-stone-100">
                            <div
                              className="w-full rounded-md bg-sky-600 transition-all"
                              style={{ height: `${Math.max(4, Math.min(100, pct))}%` }}
                              title={`${r.date}: ${r.accuracy !== null ? `${Math.round(r.accuracy)}%` : "—"} (${r.count} answers)`}
                            />
                          </div>
                          <span className="tnum text-[10px] text-stone-400">
                            {r.date.slice(5)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-stone-400">
                    Each bar is one day — taller means more accurate. Based on your last{" "}
                    {a.assessment.accuracyOverTime.length} active days
                    {maxTrend > 0 && topConcepts.length > 0 ? "." : "."}
                  </p>
                </div>
              ) : (
                <p className="mt-4 rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-500">
                  Answer your first quiz to see how your accuracy trends over time.
                </p>
              )}
            </Card>
          </section>

          {/* Understanding */}
          <section aria-label="Understanding">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-stone-500">
                Understanding
              </h2>
              <Link
                href={`/projects/${projectId}/growth`}
                className="text-xs font-medium text-sky-700 hover:text-sky-800"
              >
                View growth →
              </Link>
            </div>
            <Card className="p-5">
              <div className="mb-4 flex flex-wrap gap-2">
                <Badge tone="success">{a.mastery.improvingCount} improving</Badge>
                <Badge tone="neutral">{a.mastery.stableCount} stable</Badge>
                <Badge tone={a.mastery.requiresAttentionCount > 0 ? "danger" : "neutral"}>
                  {a.mastery.requiresAttentionCount} need attention
                </Badge>
                <span className="tnum ml-auto text-xs text-stone-400">
                  {a.mastery.totalConcepts} concepts
                </span>
              </div>
              {topConcepts.length > 0 ? (
                <ul className="space-y-2.5">
                  {topConcepts.map((c) => {
                    const pct = c.mastery !== null ? Math.max(0, Math.min(100, c.mastery)) : null;
                    return (
                      <li key={c.conceptId} className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-900" title={c.name}>
                          {c.name}
                        </span>
                        <span className="w-32 shrink-0">
                          <span className="block h-2 overflow-hidden rounded-full bg-stone-100">
                            <span
                              className="block h-full rounded-full bg-sky-600"
                              role="progressbar"
                              aria-valuenow={pct !== null ? Math.round(pct) : 0}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${c.name} mastery`}
                              style={{ width: `${pct ?? 0}%` }}
                            />
                          </span>
                        </span>
                        <span className="tnum w-11 shrink-0 text-right text-xs text-stone-500">
                          {pct !== null ? `${Math.round(pct)}%` : "—"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-stone-500">
                  Concepts appear here once you upload material.{" "}
                  <Link href={`/projects/${projectId}/materials`} className="font-medium text-sky-700 hover:text-sky-800">
                    Upload material →
                  </Link>
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-3 border-t border-stone-100 pt-3 text-xs font-medium">
                <Link href={`/projects/${projectId}/mastery`} className="text-sky-700 hover:text-sky-800">
                  View mastery →
                </Link>
                <Link href={`/projects/${projectId}/recommendations`} className="text-stone-600 hover:text-stone-900">
                  Get recommendations →
                </Link>
              </div>
            </Card>
          </section>

          {/* AI assistance — de-emphasized, human wording */}
          <section aria-label="AI assistance">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-stone-500">
              Study assistance
            </h2>
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                  <SparkIcon className="h-[18px] w-[18px]" />
                </span>
                <p className="text-sm text-stone-600">
                  <span className="tnum font-semibold text-stone-900">{a.aiActivity.totalCalls}</span>{" "}
                  explanations, quizzes and feedback generated for this project
                </p>
              </div>
              {Object.keys(a.aiActivity.perFeature).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(a.aiActivity.perFeature).map(([feat, count]) => (
                    <Badge key={feat} tone="accent" className="tnum">
                      {feat} · {count}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="mt-3 flex items-center gap-1.5 text-xs text-stone-400">
                <BookIcon className="h-3.5 w-3.5" />
                Detailed model, latency and cost breakdowns live in the admin dashboard.
              </p>
            </Card>
          </section>

          <div className="flex flex-wrap gap-3 text-xs font-medium">
            <Link href={`/projects/${projectId}/mastery`} className="text-stone-600 hover:text-stone-900">
              <ChatIcon className="mr-1 inline h-3.5 w-3.5" />
              Mastery
            </Link>
            <Link href={`/projects/${projectId}/growth`} className="text-stone-600 hover:text-stone-900">
              Growth
            </Link>
            <Link href={`/projects/${projectId}/recommendations`} className="text-stone-600 hover:text-stone-900">
              Recommendations
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
