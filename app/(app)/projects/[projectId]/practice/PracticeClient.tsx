"use client";

import { useEffect, useState } from "react";
import { Badge, Button, LinkButton, Spinner } from "@/components/ui";
import { formatDateTime } from "@/lib/datetime";
import { PracticeIcon, ArrowRightIcon } from "@/components/icons";
import {
  PRACTICE_DEFAULT_COUNT,
  PRACTICE_MAX_COUNT,
  PRACTICE_MIN_COUNT,
  PRACTICE_LEVEL_LABEL,
  PRACTICE_SECTION_LABEL,
  clampPracticeCount,
  clampPracticeLevel,
  practiceSectionFor,
  type PracticeLevel,
  type PracticeQuestionType,
  type PracticeSection,
} from "@/ai/practice";

interface AssignmentListItem {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  focus_summary: string | null;
  target_count: number;
}

interface PracticeQuestion {
  id: string;
  concept_id: string;
  concept_name?: string;
  related_concept_ids: string[];
  subconcept_label: string | null;
  intent: string;
  difficulty: string;
  question_type: PracticeQuestionType;
  question: string;
  options: string[] | null;
  selection_reason: string | null;
  reference_answer?: string | null;
  // Disclosed only for answered questions (API strips pre-submission).
  correct_answer?: string | null;
  acceptable_answers?: string[] | null;
  explanation?: string | null;
  answered?: boolean;
}

interface PracticeEvaluation {
  score: number;
  understanding_level: string;
  concepts_demonstrated: string[];
  concepts_partial: string[];
  missing_concepts: string[];
  misconceptions: string[];
  reasoning_quality: string;
  evidence_grounding: string;
  feedback: string;
  suggested_improvement: string;
}

interface PracticeResponseRecord {
  id: string;
  question_id: string;
  response: string;
  confidence: number | null;
  score: number | null;
  evaluation: PracticeEvaluation | null;
  created_at: string;
}

interface MasteryDelta {
  conceptId: string;
  conceptName: string;
  previous: number;
  evidence: number;
  newScore: number;
  source: string;
}

interface PracticeSummary {
  understood: Array<{ conceptName: string; score: number }>;
  partial: Array<{ conceptName: string; score: number }>;
  misunderstood: Array<{ conceptName: string; score: number; misconceptions: string[] }>;
  conceptsImproved: Array<{ conceptId: string; conceptName: string; previous: number; current: number; delta: number }>;
  conceptsStillWeak: Array<{ conceptId: string; conceptName: string; current: number | null }>;
  calibration: { overconfident: number; underconfident: number; calibrated: number };
  recommendedNextAction: string;
  prerequisiteNotes: string[];
}

interface ActiveAssignment {
  assignment: { id: string; project_id: string; status: string; created_at: string; focus_summary?: string | null; selection_context?: { level?: string } | null };
  questions: PracticeQuestion[];
}

const INTENT_LABEL: Record<string, string> = {
  EXPLAIN: "Explain",
  WHY: "Why / reasoning",
  APPLY: "Apply",
  COMPARE: "Compare",
  SCENARIO: "Scenario",
  PROBLEM_SOLVING: "Problem-solving",
  TEACH_BACK: "Teach-back",
};

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

function sectionOf(q: PracticeQuestion): PracticeSection {
  return practiceSectionFor((q.question_type ?? "OPEN_ENDED") as PracticeQuestionType);
}

function isObjective(q: PracticeQuestion): boolean {
  return q.question_type === "MCQ" || q.question_type === "TRUE_FALSE";
}

function isOneWord(q: PracticeQuestion): boolean {
  return q.question_type === "ONE_WORD";
}

function typeBadgeLabel(q: PracticeQuestion): string {
  if (q.question_type === "MCQ") return "Multiple choice";
  if (q.question_type === "TRUE_FALSE") return "True / False";
  if (q.question_type === "ONE_WORD") return "One word";
  return "Open ended";
}

function StepDots({ total, current, answered }: { total: number; current: number; answered: boolean[] }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Question ${current + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={`h-1.5 rounded-full transition-all ${
            i < current || (i === current && answered[i]) ? "w-6 bg-sky-600" : i === current ? "w-6 bg-stone-300" : "w-3 bg-stone-200"
          }`}
        />
      ))}
    </div>
  );
}

export default function PracticeClient({ projectId }: { projectId: string }) {
  const [assignments, setAssignments] = useState<AssignmentListItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [practiceCount, setPracticeCount] = useState<number>(PRACTICE_DEFAULT_COUNT);
  const [practiceLevel, setPracticeLevel] = useState<PracticeLevel>("MIXED");
  const [active, setActive] = useState<ActiveAssignment | null>(null);
  const [activeLevel, setActiveLevel] = useState<PracticeLevel>("MIXED");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answerText, setAnswerText] = useState("");
  const [shortText, setShortText] = useState("");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [results, setResults] = useState<Record<string, PracticeResponseRecord>>({});
  const [deltas, setDeltas] = useState<Record<string, MasteryDelta[]>>({});
  const [calibrations, setCalibrations] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [summary, setSummary] = useState<PracticeSummary | null>(null);

  const fetchAssignments = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/practice`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch practice assignments");
      setAssignments(data.assignments ?? []);
      setListError(null);
    } catch (e) {
      console.error(e);
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    fetchAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const startAssignment = async () => {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/practice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: clampPracticeCount(practiceCount), level: practiceLevel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate practice assignment");
      const a: ActiveAssignment = { assignment: data.assignment, questions: data.questions };
      setActive(a);
      setActiveLevel(clampPracticeLevel(data.level ?? practiceLevel));
      setCurrentIdx(0);
      setResults({});
      setDeltas({});
      setCalibrations({});
      setAnswerText("");
      setShortText("");
      setSelectedOption(null);
      setConfidence(null);
      setShowFeedback(false);
      setCompleted(false);
      setSummary(null);
      fetchAssignments();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const loadAssignment = async (assignmentId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/practice/${assignmentId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load practice assignment");
      const a: ActiveAssignment = { assignment: data.assignment, questions: data.questions };
      setActive(a);
      const list: PracticeResponseRecord[] = (data.responsesList ?? Array.from((data.responses ?? new Map()).values?.() ?? [])) as PracticeResponseRecord[];
      // API returns responses as object map (JSON) — normalize both shapes.
      const map: Record<string, PracticeResponseRecord> = {};
      if (Array.isArray(list)) {
        for (const r of list) map[r.question_id] = r;
      } else if (data.responses && typeof data.responses === "object") {
        for (const v of Object.values(data.responses) as PracticeResponseRecord[]) map[v.question_id] = v;
      }
      // data.responses from route is a Map serialized? service returns Map -> JSON object. Handle answers array fallback.
      if (data.answers) {
        for (const r of data.answers as PracticeResponseRecord[]) map[r.question_id] = r;
      }
      setResults(map);
      const total = a.questions.length;
      const answeredCount = Object.keys(map).length;
      const isDone = a.assignment.status === "completed" || answeredCount >= total;
      setCompleted(isDone);
      if (isDone) {
        setCurrentIdx(total);
        try {
          const sres = await fetch(`/api/projects/${projectId}/practice/${assignmentId}/summary`);
          if (sres.ok) {
            const sdata = await sres.json();
            setSummary(sdata.summary ?? null);
          }
        } catch {
          // summary best-effort
        }
      } else {
        let first = 0;
        for (let i = 0; i < total; i++) {
          if (!map[a.questions[i].id]) {
            first = i;
            break;
          }
        }
        setCurrentIdx(first);
      }
      setAnswerText("");
      setShortText("");
      setSelectedOption(null);
      setConfidence(null);
      setShowFeedback(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const currentQuestion = active?.questions[currentIdx] ?? null;
  const total = active?.questions.length ?? 0;
  const isLast = currentIdx === total - 1;
  const currentResult = currentQuestion ? results[currentQuestion.id] ?? null : null;

  const submitCurrent = async () => {
    if (!currentQuestion || !active) return;
    const objective = isObjective(currentQuestion);
    const oneWord = isOneWord(currentQuestion);
    if (objective && !selectedOption) {
      setError("Pick an option first — then submit to check it.");
      return;
    }
    if (oneWord && !shortText.trim()) {
      setError("Type your answer first — a single word or short phrase is enough.");
      return;
    }
    if (!objective && !oneWord && !answerText.trim()) {
      setError("Write your explanation first — this section is about showing understanding, not picking an option.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/practice/${active.assignment.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: currentQuestion.id,
          response: objective ? selectedOption : oneWord ? shortText.trim() : answerText.trim(),
          confidence,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit practice response");
      const rec: PracticeResponseRecord = data.response as PracticeResponseRecord;
      setResults((prev) => ({ ...prev, [currentQuestion.id]: rec }));
      setDeltas((prev) => ({ ...prev, [currentQuestion.id]: (data.masteryDeltas ?? []) as MasteryDelta[] }));
      setCalibrations((prev) => ({ ...prev, [currentQuestion.id]: data.calibration as string }));
      if (data.reference_answer !== undefined || data.correct_answer !== undefined || data.assignmentStatus) {
        setActive((prev) =>
          prev
            ? {
                ...prev,
                assignment: { ...prev.assignment, status: data.assignmentStatus ?? prev.assignment.status },
                questions: prev.questions.map((q) =>
                  q.id === currentQuestion.id
                    ? {
                        ...q,
                        answered: true,
                        correct_answer: (data.correct_answer as string | null) ?? q.correct_answer ?? null,
                        acceptable_answers: (data.acceptable_answers as string[] | null) ?? q.acceptable_answers ?? null,
                        explanation: (data.explanation as string | null) ?? q.explanation ?? null,
                        reference_answer: (data.reference_answer as string | null) ?? q.reference_answer ?? null,
                      }
                    : q
                ),
              }
            : prev
        );
      }
      setShowFeedback(true);
      if (data.assignmentCompleted) {
        setCompleted(true);
        try {
          const sres = await fetch(`/api/projects/${projectId}/practice/${active.assignment.id}/summary`);
          if (sres.ok) {
            const sdata = await sres.json();
            setSummary(sdata.summary ?? null);
          }
        } catch {
          // ignore
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    if (!active) return;
    if (!currentResult) {
      submitCurrent();
      return;
    }
    setShowFeedback(false);
    if (isLast) {
      setCompleted(true);
      setCurrentIdx(total);
      fetchAssignments();
      (async () => {
        try {
          const sres = await fetch(`/api/projects/${projectId}/practice/${active.assignment.id}/summary`);
          if (sres.ok) {
            const sdata = await sres.json();
            setSummary(sdata.summary ?? null);
          }
        } catch {
          // ignore
        }
      })();
    } else {
      setCurrentIdx(currentIdx + 1);
      const nextQ = active.questions[currentIdx + 1];
      const nextRes = nextQ ? results[nextQ.id] : null;
      setAnswerText(nextRes?.response ?? "");
      setShortText(nextQ && isOneWord(nextQ) ? (nextRes?.response ?? "") : "");
      setSelectedOption(nextQ && isObjective(nextQ) ? (nextRes?.response ?? null) : null);
      setConfidence(nextRes?.confidence ?? null);
      setShowFeedback(!!nextRes);
    }
  };

  const handlePrev = () => {
    if (currentIdx > 0 && active) {
      setCurrentIdx(currentIdx - 1);
      const prevQ = active.questions[currentIdx - 1];
      const prevRes = prevQ ? results[prevQ.id] : null;
      setAnswerText(prevRes?.response ?? "");
      setShortText(prevQ && isOneWord(prevQ) ? (prevRes?.response ?? "") : "");
      setSelectedOption(prevQ && isObjective(prevQ) ? (prevRes?.response ?? null) : null);
      setConfidence(prevRes?.confidence ?? null);
      setShowFeedback(!!prevRes);
      setError(null);
    }
  };

  const resetToList = () => {
    setActive(null);
    setActiveLevel("MIXED");
    setCurrentIdx(0);
    setResults({});
    setDeltas({});
    setCalibrations({});
    setAnswerText("");
    setShortText("");
    setSelectedOption(null);
    setConfidence(null);
    setError(null);
    setShowFeedback(false);
    setCompleted(false);
    setSummary(null);
    fetchAssignments();
  };

  // Summary view
  if (active && (currentIdx >= total || (completed && Object.keys(results).length >= total))) {
    const answered = Object.keys(results).length;
    const scores = Object.values(results).map((r) => r.score ?? 0);
    const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    return (
      <div className="fade-enter w-full space-y-5">
        <button onClick={resetToList} className="text-sm text-stone-500 transition-colors hover:text-stone-900">
          ← All practice
        </button>

        <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-card sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">Practice summary — evidence, not just a score</p>
          <p className="tnum mt-2 text-5xl font-semibold tracking-tight text-stone-900">
            {avg}
            <span className="text-2xl text-stone-400">%</span>
          </p>
          <p className="mt-2 text-sm text-stone-500">{answered} of {total} answered · Level: {PRACTICE_LEVEL_LABEL[activeLevel]}</p>
          <div className="mt-3 flex justify-center">
            <Badge tone={completed ? "success" : "warning"}>{completed ? "completed" : "in progress"}</Badge>
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button onClick={startAssignment} disabled={generating}>
              {generating ? "Building…" : "New practice assignment"}
            </Button>
            <LinkButton href={`/projects/${projectId}/tutor`} variant="secondary">
              Discuss with tutor
            </LinkButton>
            <LinkButton href={`/projects/${projectId}/mastery`} variant="secondary">
              View mastery
            </LinkButton>
          </div>
        </div>

        {summary ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-green-600/20 bg-green-50/60 p-5">
                <h3 className="text-sm font-semibold text-stone-900">What you understood</h3>
                {summary.understood.length === 0 ? (
                  <p className="mt-2 text-sm text-stone-500">Nothing solid yet — that is useful evidence too.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {summary.understood.map((u, i) => (
                      <li key={i} className="text-sm text-stone-700">
                        <span className="font-medium">{u.conceptName}</span> <span className="tnum text-xs text-stone-500">({u.score}%)</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
                <h3 className="text-sm font-semibold text-stone-900">Partially understood</h3>
                {summary.partial.length === 0 ? (
                  <p className="mt-2 text-sm text-stone-500">No partials — clear split between solid and shaky.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {summary.partial.map((p, i) => (
                      <li key={i} className="text-sm text-stone-700">
                        <span className="font-medium">{p.conceptName}</span> <span className="tnum text-xs text-stone-500">({p.score}%)</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-2xl border border-red-200 bg-red-50/60 p-5">
                <h3 className="text-sm font-semibold text-stone-900">Misunderstood</h3>
                {summary.misunderstood.length === 0 ? (
                  <p className="mt-2 text-sm text-stone-500">No major gaps this round.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {summary.misunderstood.map((m, i) => (
                      <li key={i} className="text-sm text-stone-700">
                        <span className="font-medium">{m.conceptName}</span> <span className="tnum text-xs text-stone-500">({m.score}%)</span>
                        {m.misconceptions.length > 0 && (
                          <span className="mt-1 block text-xs text-red-700">Misconception: {m.misconceptions[0]}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-card">
              <h3 className="text-sm font-semibold text-stone-900">What changed in your learning state</h3>
              {summary.conceptsImproved.length === 0 ? (
                <p className="mt-2 text-sm text-stone-500">No mastery movement recorded yet.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {summary.conceptsImproved.slice(0, 6).map((c) => (
                    <li key={c.conceptId} className="tnum text-sm text-stone-700">
                      <span className="font-medium">{c.conceptName}</span>: {Math.round(c.previous)} → {Math.round(c.current)}{" "}
                      <span className={c.delta > 5 ? "text-green-700" : c.delta < -5 ? "text-red-600" : "text-stone-500"}>
                        ({c.delta > 0 ? "+" : ""}{c.delta})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {summary.conceptsStillWeak.length > 0 && (
                <p className="mt-3 text-sm text-stone-500">
                  Still weak: {summary.conceptsStillWeak.map((c) => c.conceptName).join(", ")}
                </p>
              )}
              {(summary.calibration.overconfident > 0 || summary.calibration.underconfident > 0) && (
                <p className="mt-2 text-xs text-stone-400">
                  Confidence check: {summary.calibration.overconfident} overconfident · {summary.calibration.underconfident} underconfident · {summary.calibration.calibrated} calibrated. High confidence + weak answer reveals overconfidence; low confidence + strong answer reveals underconfidence.
                </p>
              )}
            </div>

            {summary.prerequisiteNotes.length > 0 && (
              <div className="rounded-2xl border border-sky-600/20 bg-sky-50/60 p-5">
                <h3 className="text-sm font-semibold text-stone-900">Dependency-aware tip</h3>
                <ul className="mt-2 space-y-1.5">
                  {summary.prerequisiteNotes.map((n, i) => (
                    <li key={i} className="text-sm text-stone-700">{n}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-card">
              <h3 className="text-sm font-semibold text-stone-900">Recommended next action</h3>
              <p className="mt-2 text-sm text-stone-700">{summary.recommendedNextAction}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <LinkButton href={`/projects/${projectId}/recommendations`} variant="secondary">
                  View recommendations
                </LinkButton>
                <LinkButton href={`/projects/${projectId}/growth`} variant="secondary">
                  View growth
                </LinkButton>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-center text-sm text-stone-400">Summary is being prepared…</p>
        )}

        {(["A", "B", "C"] as PracticeSection[])
          .filter((s) => active.questions.some((q) => sectionOf(q) === s))
          .map((s) => (
            <div key={s} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                Section {s} · {PRACTICE_SECTION_LABEL[s]}
              </h3>
              {active.questions.map((q) => {
                if (sectionOf(q) !== s) return null;
                const num = active.questions.indexOf(q) + 1;
                const r = results[q.id];
                const qDet = isObjective(q) || isOneWord(q);
                const qCorrect = qDet && r?.score !== null && r?.score !== undefined ? r.score === 100 : null;
                return (
                  <div key={q.id} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-card">
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-100 text-xs font-semibold text-stone-700">{num}</span>
                      <Badge tone="accent">{INTENT_LABEL[q.intent] ?? q.intent}</Badge>
                      <Badge tone="neutral">{typeBadgeLabel(q)}</Badge>
                      <Badge tone="neutral">{q.difficulty}</Badge>
                      {q.concept_name && <span className="text-xs text-stone-400">{q.concept_name}</span>}
                      {r?.score !== null && r?.score !== undefined && <span className="tnum text-xs text-stone-500">{r.score}%</span>}
                      {qCorrect !== null && <Badge tone={qCorrect ? "success" : "danger"}>{qCorrect ? "Correct" : "Incorrect"}</Badge>}
                    </div>
                    <p className="text-[15px] font-medium leading-relaxed text-stone-900">{q.question}</p>
                    <p className="mt-3 text-sm text-stone-700">
                      <span className="font-medium text-stone-900">{qDet ? "Your answer:" : "Your explanation:"}</span> {r ? r.response : <span className="text-stone-400">no response</span>}
                    </p>
                    {qDet && r && qCorrect === false && q.correct_answer && (
                      <p className="mt-1.5 text-sm text-stone-700">
                        <span className="font-medium text-green-700">Correct answer:</span> {q.correct_answer}
                        {isOneWord(q) && q.acceptable_answers && q.acceptable_answers.length > 0 && (
                          <span className="text-stone-500"> (also accepted: {q.acceptable_answers.join("; ")})</span>
                        )}
                      </p>
                    )}
                    {r?.evaluation && (
                      <div className="mt-3 space-y-1.5 rounded-xl bg-stone-50 p-4 text-sm">
                        <p className="text-stone-800"><span className="font-medium">Feedback:</span> {r.evaluation.feedback}</p>
                        <p className="text-xs text-stone-500"><span className="font-medium">Next:</span> {r.evaluation.suggested_improvement}</p>
                        {r.evaluation.misconceptions.length > 0 && (
                          <p className="text-xs text-red-700"><span className="font-medium">Misconceptions:</span> {r.evaluation.misconceptions.join("; ")}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
      </div>
    );
  }

  if (active && currentQuestion) {
    const alreadyAnswered = !!currentResult;
    const objective = isObjective(currentQuestion);
    const oneWord = isOneWord(currentQuestion);
    const determined = objective || oneWord;
    const detCorrect = determined && currentResult?.score !== null && currentResult?.score !== undefined ? currentResult.score === 100 : null;
    const section = sectionOf(currentQuestion);
    const answeredFlags = active.questions.map((q) => !!results[q.id]);
    const qDeltas = deltas[currentQuestion.id] ?? [];
    const qCal = calibrations[currentQuestion.id];
    return (
      <div className="fade-enter w-full space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={resetToList} className="text-sm text-stone-500 transition-colors hover:text-stone-900">
            ← All practice
          </button>
          <span className="tnum text-sm text-stone-500">Section {section} · {currentIdx + 1} / {total} · {PRACTICE_LEVEL_LABEL[activeLevel]}</span>
        </div>
        <StepDots total={total} current={currentIdx} answered={answeredFlags} />

        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-card sm:p-8">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="accent">Section {section} · {PRACTICE_SECTION_LABEL[section]}</Badge>
            <Badge tone="neutral">{typeBadgeLabel(currentQuestion)}</Badge>
            <Badge tone="neutral">{INTENT_LABEL[currentQuestion.intent] ?? currentQuestion.intent}</Badge>
            <Badge tone="neutral">{currentQuestion.difficulty}</Badge>
            {determined && alreadyAnswered && detCorrect !== null && (
              <Badge tone={detCorrect ? "success" : "danger"}>{detCorrect ? "Correct" : "Incorrect"}</Badge>
            )}
            {currentQuestion.concept_name && (
              <span className="text-xs text-stone-400" title="Selected from mastery + mistakes + misconceptions + growth">
                {currentQuestion.concept_name}
                {currentQuestion.subconcept_label ? ` · ${currentQuestion.subconcept_label}` : ""} · chosen for you
              </span>
            )}
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">What am I practicing?</p>
          <h3 className="mb-3 mt-1 text-lg font-medium leading-relaxed text-stone-900">{currentQuestion.question}</h3>
          {currentQuestion.selection_reason && (
            <p className="mb-4 rounded-xl bg-sky-50/70 px-3.5 py-2.5 text-xs leading-relaxed text-stone-600">
              <span className="font-semibold text-stone-800">Why this question:</span> {currentQuestion.selection_reason}
            </p>
          )}

          {objective ? (
            <div>
              <div className="space-y-2.5" role="radiogroup" aria-label="Answer options">
                {(currentQuestion.options ?? []).map((opt, idx) => {
                  const isSelected = selectedOption === opt;
                  const isResponse = alreadyAnswered && currentResult?.response === opt;
                  const showVerdict = alreadyAnswered && detCorrect !== null;
                  const verdictGood = showVerdict && opt === currentQuestion.correct_answer;
                  const verdictBad = showVerdict && isResponse && !detCorrect;
                  return (
                    <label
                      key={idx}
                      className={`flex cursor-pointer items-center gap-3.5 rounded-2xl border p-4 transition-all ${
                        verdictGood
                          ? "border-green-600 bg-green-50 ring-1 ring-green-600"
                          : verdictBad
                            ? "border-red-300 bg-red-50"
                            : isSelected
                              ? "border-sky-600 bg-sky-50 ring-1 ring-sky-600"
                              : "border-stone-200 bg-white hover:border-stone-400 hover:bg-stone-50"
                      } ${alreadyAnswered ? "cursor-default" : ""}`}
                    >
                      <span
                        aria-hidden
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                          verdictGood
                            ? "bg-green-600 text-white"
                            : verdictBad
                              ? "bg-red-500 text-white"
                              : isSelected && !alreadyAnswered
                                ? "bg-sky-600 text-white"
                                : "bg-stone-100 text-stone-500"
                        }`}
                      >
                        {OPTION_LETTERS[idx] ?? idx + 1}
                      </span>
                      <input
                        type="radio"
                        name="practice-mcq-option"
                        value={opt}
                        checked={isSelected || isResponse}
                        onChange={() => !alreadyAnswered && setSelectedOption(opt)}
                        disabled={alreadyAnswered}
                        className="sr-only"
                      />
                      <span className="text-[15px] text-stone-900">{opt}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-stone-400">Section A · Objective — checked instantly, no waiting on AI grading.</p>
            </div>
          ) : oneWord ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-stone-700">Your answer</label>
              <input
                type="text"
                value={alreadyAnswered ? (currentResult?.response ?? shortText) : shortText}
                onChange={(e) => !alreadyAnswered && setShortText(e.target.value)}
                placeholder="One word or short phrase…"
                maxLength={120}
                disabled={alreadyAnswered}
                className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-[15px] focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600 disabled:bg-stone-50"
              />
              <p className="mt-2 text-xs text-stone-400">Section B · Short answer — spelling variants and synonyms count, case doesn&apos;t matter.</p>
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-stone-700">Your explanation</label>
              <textarea
                value={alreadyAnswered ? (currentResult?.response ?? answerText) : answerText}
                onChange={(e) => !alreadyAnswered && setAnswerText(e.target.value)}
                placeholder="Explain in your own words — reasoning matters more than the right phrase…"
                rows={6}
                disabled={alreadyAnswered}
                className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-[15px] focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600 disabled:bg-stone-50"
              />
              <p className="mt-2 text-xs text-stone-400">Section C · Descriptive — AI evaluates understanding and collects evidence for mastery, growth, and recommendations.</p>
            </div>
          )}

          {!alreadyAnswered && (
            <div className="mt-4">
              <p className="mb-1.5 text-sm font-medium text-stone-700">How confident were you? <span className="font-normal text-stone-400">(optional)</span></p>
              <div className="flex gap-2" role="radiogroup" aria-label="Confidence">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setConfidence(confidence === n ? null : n)}
                    aria-pressed={confidence === n}
                    className={`tnum flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition-colors ${
                      confidence === n ? "border-sky-600 bg-sky-600 text-white" : "border-stone-200 bg-white text-stone-500 hover:border-stone-400"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <span className="ml-1 self-center text-xs text-stone-400">1 = guessing · 5 = certain</span>
              </div>
            </div>
          )}

          {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

          {showFeedback && currentResult?.evaluation && (
            <div className={`mt-5 space-y-3 rounded-2xl border p-5 ${determined ? (detCorrect ? "border-green-600/30 bg-green-50" : "border-red-200 bg-red-50/60") : "border-stone-200 bg-stone-50"}`}>
              {determined ? (
                <div className="space-y-1.5 text-sm">
                  <p className={`text-[15px] font-semibold ${detCorrect ? "text-green-700" : "text-stone-900"}`}>
                    {detCorrect ? "Correct — nice work" : "Not quite"} <span className="tnum text-xs font-normal text-stone-500">({currentResult.score}/100)</span>
                  </p>
                  <p className="text-stone-800"><span className="font-medium">Feedback:</span> {currentResult.evaluation.feedback}</p>
                  {oneWord && currentQuestion.acceptable_answers && currentQuestion.acceptable_answers.length > 0 && (
                    <p className="text-xs text-stone-500"><span className="font-medium">Also accepted:</span> {currentQuestion.acceptable_answers.join("; ")}</p>
                  )}
                  {currentQuestion.explanation && (
                    <p className="text-xs text-stone-500"><span className="font-medium">Why:</span> {currentQuestion.explanation}</p>
                  )}
                  <p className="text-xs text-stone-500"><span className="font-medium">Next:</span> {currentResult.evaluation.suggested_improvement}</p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-stone-900">Score: {currentResult.score}%</span>
                <Badge tone={currentResult.evaluation.understanding_level === "ADVANCED" || currentResult.evaluation.understanding_level === "PROFICIENT" ? "success" : currentResult.evaluation.understanding_level === "DEVELOPING" ? "warning" : "danger"}>
                  {currentResult.evaluation.understanding_level.toLowerCase()}
                </Badge>
                <Badge tone={currentResult.evaluation.reasoning_quality === "strong" ? "success" : currentResult.evaluation.reasoning_quality === "partial" ? "warning" : "danger"}>
                  reasoning: {currentResult.evaluation.reasoning_quality}
                </Badge>
                <Badge tone="neutral">grounding: {currentResult.evaluation.evidence_grounding}</Badge>
                {qCal && qCal !== "UNKNOWN" && (
                  <Badge tone={qCal === "CALIBRATED" ? "success" : "warning"}>
                    {qCal === "OVERCONFIDENT" ? "overconfident" : qCal === "UNDERCONFIDENT" ? "underconfident" : "calibrated"}
                  </Badge>
                )}
              </div>
              <div className="space-y-1.5 text-sm">
                <p className="font-medium text-stone-900">What did I demonstrate?</p>
                {currentResult.evaluation.concepts_demonstrated.length > 0 ? (
                  <p className="text-stone-700">Showed: {currentResult.evaluation.concepts_demonstrated.join("; ")}</p>
                ) : (
                  <p className="text-stone-500">No fully demonstrated ideas yet.</p>
                )}
                {currentResult.evaluation.concepts_partial.length > 0 && (
                  <p className="text-amber-700">Partial: {currentResult.evaluation.concepts_partial.join("; ")}</p>
                )}
                {currentResult.evaluation.missing_concepts.length > 0 && (
                  <p className="text-stone-500">Missing: {currentResult.evaluation.missing_concepts.join("; ")}</p>
                )}
                {currentResult.evaluation.misconceptions.length > 0 && (
                  <p className="text-red-700">Misconceptions: {currentResult.evaluation.misconceptions.join("; ")}</p>
                )}
                <p className="text-stone-800"><span className="font-medium">Feedback:</span> {currentResult.evaluation.feedback}</p>
                <p className="text-stone-700"><span className="font-medium">Improve by:</span> {currentResult.evaluation.suggested_improvement}</p>
                {currentQuestion.reference_answer && (
                  <p className="text-xs text-stone-400">Strong answer looks like: {currentQuestion.reference_answer}</p>
                )}
                  </div>
                </>
              )}
              {qDeltas.length > 0 && (
                <div className="rounded-xl bg-white p-3.5 ring-1 ring-inset ring-stone-200">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">What changed in your learning state</p>
                  <ul className="tnum mt-1.5 space-y-1 text-sm text-stone-700">
                    {qDeltas.map((d) => (
                      <li key={d.conceptId}>
                        <span className="font-medium">{d.conceptName}</span> ({d.source}): {Math.round(d.previous)} → {Math.round(d.newScore)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={handlePrev}
              disabled={currentIdx === 0}
              className="rounded-lg px-4 py-2 text-sm font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              ← Previous
            </button>
            {!alreadyAnswered && !showFeedback ? (
              <Button onClick={submitCurrent} disabled={submitting || (objective ? !selectedOption : oneWord ? !shortText.trim() : !answerText.trim())} className="min-w-32">
                {submitting && <Spinner className="text-white" />}
                {submitting ? (determined ? "Checking…" : "Evaluating…") : determined ? "Submit answer" : "Submit explanation"}
                {!submitting && <ArrowRightIcon className="h-4 w-4" />}
              </Button>
            ) : (
              <Button onClick={handleNext} className="min-w-32">
                {isLast ? (completed ? "View summary" : "Finish") : "Next question"}
                <ArrowRightIcon className="h-4 w-4" />
              </Button>
            )}
          </div>
          {submitting && <p className="mt-2 text-center text-xs text-stone-400">{determined ? "Checking your answer…" : "Evaluating understanding + extracting evidence…"}</p>}
        </div>

        <p className="text-center text-xs text-stone-400">
          Each explanation updates mastery, growth, misconceptions, and recommendations — evidence first, scores second.
        </p>
      </div>
    );
  }

  return (
    <div className="fade-enter w-full space-y-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-card sm:p-8">
        <div className="flex items-start gap-4">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-600 text-white">
            <PracticeIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-stone-900">Practice assignment</h2>
            <p className="mt-1 text-sm leading-relaxed text-stone-500">
              An exam-style paper built from your weak concepts, recent mistakes, misconceptions, growth trend, and prerequisites.
            </p>
            <div className="mt-3 grid gap-2 text-xs leading-relaxed text-stone-500 sm:grid-cols-3">
              <div className="rounded-xl bg-stone-50 px-3.5 py-2.5 ring-1 ring-inset ring-stone-200">
                <span className="font-semibold text-stone-700">Section A · Objective.</span> Multiple-choice + True/False — quick checks, instant marking.
              </div>
              <div className="rounded-xl bg-stone-50 px-3.5 py-2.5 ring-1 ring-inset ring-stone-200">
                <span className="font-semibold text-stone-700">Section B · Short answer.</span> One word or short phrase — synonyms count.
              </div>
              <div className="rounded-xl bg-stone-50 px-3.5 py-2.5 ring-1 ring-inset ring-stone-200">
                <span className="font-semibold text-stone-700">Section C · Descriptive.</span> Explain, reason, teach back — AI evaluates evidence.
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-1.5 py-1" aria-label="Number of questions">
                <button
                  type="button"
                  onClick={() => setPracticeCount((c) => clampPracticeCount(c - 1))}
                  disabled={generating || practiceCount <= PRACTICE_MIN_COUNT}
                  aria-label="Fewer questions"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-base font-semibold text-stone-600 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  −
                </button>
                <span className="tnum min-w-16 text-center text-sm font-semibold text-stone-900" aria-live="polite">
                  {practiceCount} {practiceCount === 1 ? "question" : "questions"}
                </span>
                <button
                  type="button"
                  onClick={() => setPracticeCount((c) => clampPracticeCount(c + 1))}
                  disabled={generating || practiceCount >= PRACTICE_MAX_COUNT}
                  aria-label="More questions"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-base font-semibold text-stone-600 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  +
                </button>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-1.5 py-1" aria-label="Paper level">
                {(["MIXED", "EASY", "MEDIUM", "HARD"] as PracticeLevel[]).map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    onClick={() => setPracticeLevel(lv)}
                    disabled={generating}
                    aria-pressed={practiceLevel === lv}
                    title={lv === "MIXED" ? "Difficulty adapts per concept" : `All questions ${lv.toLowerCase()}`}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      practiceLevel === lv ? "bg-sky-600 text-white" : "text-stone-500 hover:bg-stone-100"
                    }`}
                  >
                    {PRACTICE_LEVEL_LABEL[lv]}
                  </button>
                ))}
              </div>
              <Button onClick={startAssignment} disabled={generating}>
                {generating && <Spinner className="text-white" />}
                {generating ? "Building your assignment…" : "Start assignment"}
              </Button>
              <LinkButton href={`/projects/${projectId}/quiz`} variant="secondary">
                Take a quiz instead
              </LinkButton>
            </div>
            {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
            {error?.includes("007_practice") || error?.includes("008_practice_mcq") || error?.includes("009_practice_sections") ? (
              <p className="mt-2 rounded-xl bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-600/25">
                Setup needed: run <span className="font-mono">npm run migrate</span> (or apply the SQL in <span className="font-mono">db/schema/</span> via the Supabase SQL Editor), then try again.
              </p>
            ) : null}
            {generating && <p className="mt-2 text-xs text-stone-400">Analyzing mastery + misconceptions + selecting intents…</p>}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-stone-900">History</h3>
          <button onClick={fetchAssignments} className="text-xs font-medium text-stone-500 transition-colors hover:text-stone-900">
            Refresh
          </button>
        </div>
        {fetching ? (
          <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading practice">
            <div className="skeleton h-12 w-full" />
            <div className="skeleton h-12 w-full" />
            <div className="skeleton h-12 w-2/3" />
          </div>
        ) : listError ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-stone-900">Couldn&apos;t load practice</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">{listError}</p>
            {listError.includes("007_practice") || listError.includes("008_practice_mcq") || listError.includes("009_practice_sections") ? (
              <p className="mx-auto mt-2 max-w-md rounded-xl bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-600/25">
                Setup needed: run <span className="font-mono">npm run migrate</span> (or apply the SQL in <span className="font-mono">db/schema/</span> via the Supabase SQL Editor), then press Refresh.
              </p>
            ) : null}
            <button onClick={fetchAssignments} className="mt-4 text-xs font-medium text-stone-500 transition-colors hover:text-stone-900">
              Retry
            </button>
          </div>
        ) : assignments.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-stone-100 text-stone-500">
              <PracticeIcon className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-stone-900">No practice yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">Start your first assignment above — needs at least one processed PDF with concepts.</p>
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {assignments.map((a) => (
              <li key={a.id}>
                <button onClick={() => loadAssignment(a.id)} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-stone-50">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-stone-900">
                      Practice {a.id.slice(0, 8)}
                      <Badge tone={a.status === "completed" ? "success" : "warning"}>{a.status}</Badge>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-stone-400">{a.focus_summary ?? formatDateTime(a.created_at)}</p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-stone-500">Open →</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
