import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getProject } from "@/services/project.service";
import { getProjectAnalytics } from "@/services/analytics.service";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Alert, Badge, Card, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import {
  BookIcon,
  CardsIcon,
  ChartIcon,
  ChatIcon,
  PracticeIcon,
  QuizIcon,
  SparkIcon,
  TargetIcon,
  TrendUpIcon,
} from "@/components/icons";

/** Human wording for ai_operations feature keys (model/cost detail stays in admin). */
const FEATURE_LABELS: Record<string, string> = {
  TUTOR: "tutor answers",
  CONVERSATION_SUMMARY: "conversation summaries",
  EMBEDDING: "search indexing",
  QUIZ_GENERATION: "quizzes",
  OPEN_ENDED_EVALUATION: "answer feedback",
  CONCEPT_EXTRACTION: "concept maps",
  RECOMMENDATION: "recommendations",
  FLASHCARD_GENERATION: "flashcards",
  SUBCONCEPT_GENERATION: "sub-concepts",
  PRACTICE_GENERATION: "practice papers",
  PRACTICE_EVALUATION: "practice feedback",
};

function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key.toLowerCase().replace(/_/g, " ");
}

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
    a.learningActivity.tutorMessagesSent > 0 ||
    a.learningActivity.quizAttempts > 0 ||
    a.learningActivity.questionsAnswered > 0 ||
    a.learningActivity.practiceSessions > 0 ||
    a.learningActivity.practiceAnswers > 0 ||
    a.learningActivity.flashcardReviews > 0;

  // Weakest tested concept drives the "what next" actions; untested last so
  // real gaps surface before unmeasured topics.
  const tested = a.mastery.perConcept.filter((c) => c.mastery !== null);
  const untested = a.mastery.perConcept.filter((c) => c.mastery === null);
  const weakest = [...tested].sort((x, y) => (x.mastery ?? 0) - (y.mastery ?? 0))[0] ?? null;
  const focusConcept = weakest ?? untested[0] ?? null;
  const focusList = [
    ...[...tested].sort((x, y) => (x.mastery ?? 0) - (y.mastery ?? 0)),
    ...untested,
  ].slice(0, 8);

  const trendDays = a.assessment.accuracyOverTime;
  const trendAnswers = trendDays.reduce((s, r) => s + r.count, 0);
  const tutorHref = focusConcept
    ? `/projects/${projectId}/tutor?q=${encodeURIComponent(`Help me improve "${focusConcept.name}" using my study material`)}`
    : `/projects/${projectId}/tutor`;

  return (
    <div className="page-enter">
      <PageHeader
        title="Analytics"
        description="What improved, what needs attention, why — and what to do next."
        actions={
          <>
            <LinkButton href={`/projects/${projectId}/quiz`} variant="secondary" size="sm">
              <QuizIcon className="h-4 w-4" />
              Take a quiz
            </LinkButton>
            <LinkButton href={`/projects/${projectId}/practice`} variant="secondary" size="sm">
              <PracticeIcon className="h-4 w-4" />
              Practice
            </LinkButton>
          </>
        }
      />

      {!hasActivity && a.mastery.totalConcepts === 0 ? (
        <EmptyState
          icon={<ChartIcon className="h-5 w-5" />}
          title="No activity yet"
          description="Ask the Tutor a question or take your first quiz — your study insights will appear here."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href={`/projects/${projectId}/tutor`} size="sm">
                <ChatIcon className="h-4 w-4" />
                Ask the Tutor
              </LinkButton>
              <LinkButton href={`/projects/${projectId}/materials`} variant="secondary" size="sm">
                Upload material
              </LinkButton>
            </div>
          }
        />
      ) : (
        <div className="space-y-6">
          {/* Start here: improved → attention → next */}
          <section aria-label="Start here">
            <Card
              className={
                a.mastery.requiresAttentionCount > 0
                  ? "border-amber-600/25 bg-amber-50/40 p-5"
                  : "border-sky-600/15 bg-sky-50/40 p-5"
              }
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-sm font-semibold text-stone-900">
                  {a.mastery.requiresAttentionCount > 0
                    ? "Start with what needs attention"
                    : a.mastery.improvingCount > 0
                      ? "You are improving — keep momentum"
                      : "Build your first evidence"}
                </h2>
                <span className="tnum text-xs text-stone-500">
                  {a.mastery.improvingCount} improving · {a.mastery.requiresAttentionCount} need attention
                  {a.mastery.untestedCount > 0 ? ` · ${a.mastery.untestedCount} not yet tested` : ""}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-stone-600">
                {focusConcept && focusConcept.mastery !== null ? (
                  <>
                    Weakest right now: <strong className="text-stone-900">{focusConcept.name}</strong> (
                    {Math.round(focusConcept.mastery)}/100)
                    {a.mastery.requiresAttentionCount > 0
                      ? " — practice it next, then ask the Tutor about what felt shaky."
                      : " — a short quiz will confirm whether it sticks."}
                  </>
                ) : focusConcept ? (
                  <>
                    Start with <strong className="text-stone-900">{focusConcept.name}</strong> — no results yet,
                    so a first quiz turns it into measurable progress.
                  </>
                ) : a.mastery.totalConcepts === 0 ? (
                  <>
                    Upload material to create concepts, then take a quiz — this page turns your answers into a
                    prioritized plan.
                  </>
                ) : (
                  <>Take a quiz to generate fresh mastery evidence.</>
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <LinkButton href={`/projects/${projectId}/quiz`} size="sm">
                  <QuizIcon className="h-4 w-4" />
                  Quiz{focusConcept ? ` on ${focusConcept.name.slice(0, 24)}${focusConcept.name.length > 24 ? "…" : ""}` : ""}
                </LinkButton>
                <LinkButton href={tutorHref} variant="secondary" size="sm">
                  <ChatIcon className="h-4 w-4" />
                  Ask Tutor
                </LinkButton>
                <LinkButton href={`/projects/${projectId}/recommendations`} variant="secondary" size="sm">
                  <SparkIcon className="h-4 w-4" />
                  Get recommendations
                </LinkButton>
              </div>
            </Card>
          </section>

          {/* Study activity — every evidence source, not just quizzes */}
          <section aria-label="Study activity">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-stone-500">
              Study activity
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
                label="Practice sessions"
                value={a.learningActivity.practiceSessions}
                sub={`${a.learningActivity.practiceAnswers} answers written`}
                icon={<PracticeIcon className="h-[18px] w-[18px]" />}
              />
              <Stat
                label="Flashcard reviews"
                value={a.learningActivity.flashcardReviews}
                sub="Self-reported recall evidence"
                icon={<CardsIcon className="h-[18px] w-[18px]" />}
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
                    ? `From ${a.assessment.totalAnswers} graded answers`
                    : "Take a quiz to measure"
                }
                icon={<TrendUpIcon className="h-[18px] w-[18px]" />}
              />
            </div>
          </section>

          {/* Quiz performance — graded quiz answers only */}
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
                  <p className="mt-1 text-xs text-stone-400">Out of 100, graded quiz answers</p>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-stone-500">Written answers</p>
                  <p className="tnum mt-1 text-2xl font-semibold tracking-tight text-stone-900">
                    {a.assessment.averageOpenEndedScore !== null
                      ? Math.round(a.assessment.averageOpenEndedScore)
                      : "—"}
                  </p>
                  <p className="mt-1 text-xs text-stone-400">
                    {a.assessment.openEndedCount} written responses answered
                  </p>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-stone-500">Question mix</p>
                  <p className="tnum mt-1 text-sm font-semibold text-stone-900">
                    {a.assessment.mcqCount} quick · {a.assessment.openEndedCount} written
                  </p>
                  <p className="mt-1 text-xs text-stone-400">By question type, from your answers</p>
                </div>
              </div>

              {trendDays.length > 0 ? (
                <div className="mt-5 border-t border-stone-100 pt-4">
                  <p className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-stone-400">
                    Accuracy by day
                  </p>
                  <div
                    className="flex items-end gap-2"
                    role="img"
                    aria-label={`Accuracy by day across ${trendDays.length} active days`}
                  >
                    {trendDays.map((r) => {
                      const has = r.accuracy !== null;
                      const pct = has ? Math.max(4, Math.min(100, r.accuracy!)) : 0;
                      return (
                        <div key={r.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                          <span className="tnum hidden text-[10px] font-medium text-stone-500 sm:block">
                            {has ? `${Math.round(r.accuracy!)}%` : "—"}
                          </span>
                          <div className="flex h-16 w-full items-end rounded-md bg-stone-100">
                            <div
                              className={`w-full rounded-md transition-all ${has ? "bg-sky-600" : "bg-stone-300"}`}
                              style={{ height: has ? `${pct}%` : "8%" }}
                              title={`${r.date}: ${has ? `${Math.round(r.accuracy!)}% accurate` : "no graded answers"} (${r.count} answers${r.avgScore !== null ? `, avg ${Math.round(r.avgScore)}` : ""})`}
                            />
                          </div>
                          <span className="tnum text-[10px] text-stone-400">{r.date.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-stone-400">
                    {trendDays.length === 1
                      ? "One active day so far — answer quizzes on another day to see a real trend."
                      : `Across your last ${trendDays.length} active days · ${trendAnswers} answers. Grey bars mean no graded answers that day.`}
                  </p>
                </div>
              ) : (
                <p className="mt-4 rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-500">
                  Answer your first quiz to see how your accuracy changes day by day.{" "}
                  <Link href={`/projects/${projectId}/quiz`} className="font-medium text-sky-700 hover:text-sky-800">
                    Take a quiz →
                  </Link>
                </p>
              )}
            </Card>
          </section>

          {/* Understanding — weakest first, untested last */}
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
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge tone="success">{a.mastery.improvingCount} improving</Badge>
                <Badge tone="neutral">{a.mastery.stableCount} stable</Badge>
                <Badge tone={a.mastery.requiresAttentionCount > 0 ? "danger" : "neutral"}>
                  {a.mastery.requiresAttentionCount} need attention
                </Badge>
                {a.mastery.untestedCount > 0 && (
                  <Badge tone="accent">{a.mastery.untestedCount} not yet tested</Badge>
                )}
                <span className="tnum ml-auto text-xs text-stone-400">
                  {a.mastery.totalConcepts} concepts
                </span>
              </div>
              {focusList.length > 0 ? (
                <>
                  <p className="mb-2.5 text-xs text-stone-400">
                    Weakest first — start at the top. Untested topics sit at the end until a quiz measures them.
                  </p>
                  <ul className="space-y-2.5">
                    {focusList.map((c) => {
                      const pct = c.mastery !== null ? Math.max(0, Math.min(100, c.mastery)) : null;
                      return (
                        <li key={c.conceptId} className="flex items-center gap-3">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-900" title={c.name}>
                            {c.name}
                          </span>
                          <span className="w-32 shrink-0">
                            <span className="block h-2 overflow-hidden rounded-full bg-stone-100">
                              <span
                                className={`block h-full rounded-full ${pct === null ? "bg-stone-300" : pct >= 70 ? "bg-sky-600" : pct >= 35 ? "bg-amber-500" : "bg-orange-500"}`}
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
                </>
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
                {focusConcept && (
                  <Link href={tutorHref} className="text-stone-600 hover:text-stone-900">
                    Ask Tutor about {focusConcept.name.slice(0, 28)}
                    {focusConcept.name.length > 28 ? "…" : ""} →
                  </Link>
                )}
              </div>
            </Card>
          </section>

          {/* What to do next — every loop flow, one tap away */}
          <section aria-label="What to do next">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-stone-500">
              What to do next
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { href: `/projects/${projectId}/quiz`, icon: <QuizIcon className="h-4 w-4" />, title: "Retake quiz", text: "Fast check on weakest topics" },
                { href: `/projects/${projectId}/practice`, icon: <PracticeIcon className="h-4 w-4" />, title: "Deep practice", text: "Explain and apply ideas" },
                { href: tutorHref, icon: <ChatIcon className="h-4 w-4" />, title: "Ask Tutor", text: focusConcept ? `About ${focusConcept.name.slice(0, 26)}${focusConcept.name.length > 26 ? "…" : ""}` : "Grounded in your materials" },
                { href: `/projects/${projectId}/flashcards`, icon: <CardsIcon className="h-4 w-4" />, title: "Flashcards", text: "Quick recall on weak cards" },
              ].map((c) => (
                <Link
                  key={c.title}
                  href={c.href}
                  className="group rounded-xl border border-stone-200 bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                    {c.icon}
                  </span>
                  <span className="mt-2 block text-sm font-semibold text-stone-900">{c.title}</span>
                  <span className="mt-0.5 block text-xs text-stone-500">{c.text}</span>
                </Link>
              ))}
            </div>
          </section>

          {/* Study assistance — quiet footnote, human wording */}
          <section aria-label="Study assistance">
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                  <SparkIcon className="h-[18px] w-[18px]" />
                </span>
                <p className="text-sm text-stone-600">
                  <span className="tnum font-semibold text-stone-900">{a.aiActivity.totalCalls}</span>{" "}
                  study aids generated for this project
                  {Object.keys(a.aiActivity.perFeature).length > 0 && (
                    <>: {Object.entries(a.aiActivity.perFeature).map(([feat, count]) => `${count} ${featureLabel(feat)}`).join(" · ")}</>
                  )}
                </p>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-stone-400">
                <BookIcon className="h-3.5 w-3.5" />
                Model, latency and cost breakdowns live in the admin dashboard.
              </p>
            </Card>
          </section>

          <div className="flex flex-wrap gap-3 text-xs font-medium">
            <Link href={`/projects/${projectId}/mastery`} className="text-stone-600 hover:text-stone-900">
              Mastery
            </Link>
            <Link href={`/projects/${projectId}/growth`} className="text-stone-600 hover:text-stone-900">
              Growth
            </Link>
            <Link href={`/projects/${projectId}/recommendations`} className="text-stone-600 hover:text-stone-900">
              Recommendations
            </Link>
            <Link href={`/projects/${projectId}/materials`} className="text-stone-600 hover:text-stone-900">
              Materials
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
