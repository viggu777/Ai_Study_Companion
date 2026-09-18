"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, LinkButton, Spinner } from "@/components/ui";
import { formatDateTime } from "@/lib/datetime";
import { QuizIcon, ArrowRightIcon } from "@/components/icons";
import {
  QUIZ_DEFAULT_COUNT,
  QUIZ_MAX_COUNT,
  QUIZ_MIN_COUNT,
  clampQuizCount,
} from "@/ai/quiz";

interface ConceptMeta {
  conceptId: string;
  conceptName: string;
  description: string | null;
  sourceMaterialId: string | null;
  materialName: string | null;
  currentScore: number | null;
}

/** Practice timer presets (minutes). 0 = no limit. Client-only — no backend change. */
const TIME_LIMIT_OPTIONS = [0, 5, 10, 15, 20];

function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function topicTone(score: number | null): "neutral" | "warning" | "accent" | "success" {
  if (score === null) return "neutral";
  if (score < 35) return "warning";
  if (score < 70) return "accent";
  return "success";
}

function topicLabel(score: number | null): string {
  if (score === null) return "Untested";
  if (score < 35) return `${Math.round(score)}% Weak`;
  if (score < 70) return `${Math.round(score)}% Dev`;
  return `${Math.round(score)}% Strong`;
}

interface QuizListItem {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
}

interface QuizQuestion {
  id: string;
  concept_id: string;
  concept_name?: string;
  type: "MCQ" | "OPEN_ENDED";
  difficulty: string;
  question: string;
  options: string[] | null;
  // Present only for answered questions (API strips pre-submission).
  correct_answer?: string | null;
  explanation?: string | null;
  answered?: boolean;
}

interface ActiveQuiz {
  quiz: { id: string; project_id: string; status: string; created_at: string; completed_at?: string | null };
  questions: QuizQuestion[];
}

interface AssessmentEvaluation {
  score: number;
  understanding: string;
  strengths: string[];
  missingConcepts: string[];
  reasoningQuality: "strong" | "partial" | "weak";
  feedback: string;
}

interface AnswerRecord {
  id: string;
  question_id: string;
  response: string;
  is_correct: boolean | null;
  score: number | null;
  evaluation: AssessmentEvaluation | null;
  created_at: string;
}

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

function StepDots({ total, current, answered }: { total: number; current: number; answered: boolean[] }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Question ${current + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={`h-1.5 rounded-full transition-all ${
            i < current || (i === current && answered[i])
              ? "w-6 bg-sky-600"
              : i === current
                ? "w-6 bg-stone-300"
                : "w-3 bg-stone-200"
          }`}
        />
      ))}
    </div>
  );
}

export default function QuizClient({
  projectId,
  initialCount,
  autostart,
}: {
  projectId: string;
  /** deep-link from Tutor: pre-select the question count */
  initialCount?: number;
  /** deep-link from Tutor: start the round automatically on load */
  autostart?: boolean;
}) {
  const [quizzes, setQuizzes] = useState<QuizListItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quizCount, setQuizCount] = useState<number>(
    initialCount !== undefined ? clampQuizCount(initialCount) : QUIZ_DEFAULT_COUNT
  );
  const autoStartedRef = useRef(false);
  const [activeQuiz, setActiveQuiz] = useState<ActiveQuiz | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string>("");
  const [openResponse, setOpenResponse] = useState<string>("");
  const [results, setResults] = useState<Record<string, AnswerRecord>>({});
  const [submitting, setSubmitting] = useState(false);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  // ---- Topic scope (checkboxes grouped by material) ----
  const [concepts, setConcepts] = useState<ConceptMeta[]>([]);
  const [conceptsLoading, setConceptsLoading] = useState(true);
  const [conceptsError, setConceptsError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionInitRef = useRef(false);
  const [topicSearch, setTopicSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // ---- Practice timer (client-only elapsed + optional countdown) ----
  const [timeLimitMin, setTimeLimitMin] = useState<number>(0);
  const [quizStartAt, setQuizStartAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [timeUp, setTimeUp] = useState(false);

  const fetchQuizzes = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/quiz`);
      if (!res.ok) throw new Error("Failed to fetch quizzes");
      const data = await res.json();
      setQuizzes(data.quizzes ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    fetchQuizzes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Topic scope data — same endpoint as the Concepts page (includes mastery +
  // material names), so no new API is needed.
  const fetchConcepts = async () => {
    setConceptsLoading(true);
    setConceptsError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/concepts`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load topics");
      const list = (data.concepts ?? []) as ConceptMeta[];
      setConcepts(list);
      // Default: everything selected. Only auto-init once so a background
      // refetch never wipes the user's manual checkbox choices.
      if (!selectionInitRef.current && list.length > 0) {
        selectionInitRef.current = true;
        setSelectedIds(new Set(list.map((c) => c.conceptId)));
      }
    } catch (e) {
      setConceptsError(e instanceof Error ? e.message : String(e));
    } finally {
      setConceptsLoading(false);
    }
  };

  useEffect(() => {
    fetchConcepts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Group selected-able topics by source material for the checkbox tree.
  const grouped = useMemo(() => {
    const q = topicSearch.trim().toLowerCase();
    const map = new Map<string, { key: string; materialName: string; materialId: string | null; items: ConceptMeta[] }>();
    for (const c of concepts) {
      if (
        q &&
        !(
          c.conceptName.toLowerCase().includes(q) ||
          (c.description ?? "").toLowerCase().includes(q) ||
          (c.materialName ?? "").toLowerCase().includes(q)
        )
      )
        continue;
      const key = c.sourceMaterialId ?? `__none__${c.materialName ?? "Other"}`;
      const entry = map.get(key) ?? {
        key,
        materialName: c.materialName ?? "Other / no source",
        materialId: c.sourceMaterialId,
        items: [],
      };
      entry.items.push(c);
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length || a.materialName.localeCompare(b.materialName));
  }, [concepts, topicSearch]);

  const totalTopics = concepts.length;
  const selectedCount = selectedIds.size;
  const partialSelection = totalTopics > 0 && selectedCount > 0 && selectedCount < totalTopics;
  const effectiveMax = Math.min(QUIZ_MAX_COUNT, Math.max(selectedCount, 1));
  const clampedForSelection = Math.min(clampQuizCount(quizCount), effectiveMax);

  const toggleConcept = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMaterial = (items: ConceptMeta[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allOn = items.every((c) => next.has(c.conceptId));
      if (allOn) for (const c of items) next.delete(c.conceptId);
      else for (const c of items) next.add(c.conceptId);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(concepts.map((c) => c.conceptId)));
  const clearAll = () => setSelectedIds(new Set());
  const selectWeak = () =>
    setSelectedIds(new Set(concepts.filter((c) => c.currentScore === null || c.currentScore < 50).map((c) => c.conceptId)));
  const selectUntested = () => setSelectedIds(new Set(concepts.filter((c) => c.currentScore === null).map((c) => c.conceptId)));

  // Timer tick — runs only while a round is actively being taken.
  const isSummary = !!activeQuiz && (currentIdx >= (activeQuiz?.questions.length ?? 0) || (quizCompleted && Object.keys(results).length >= (activeQuiz?.questions.length ?? 0)));
  useEffect(() => {
    if (!activeQuiz || quizStartAt === null || isSummary || timeUp) return;
    const id = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - quizStartAt) / 1000);
      setElapsedSec(elapsed);
      if (timeLimitMin > 0 && elapsed >= timeLimitMin * 60) {
        setTimeUp(true);
        // Time's up: jump to summary so already-given answers are kept and
        // the round can be reviewed. Nothing is auto-submitted.
        setCurrentIdx(activeQuiz.questions.length);
        window.clearInterval(id);
      }
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuiz, quizStartAt, isSummary, timeUp, timeLimitMin]);

  const timeLeftSec = timeLimitMin > 0 ? Math.max(0, timeLimitMin * 60 - elapsedSec) : null;

  const startQuiz = async () => {
    if (totalTopics > 0 && selectedCount === 0) {
      setError("Select at least one topic to start a quiz.");
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      // Partial checkbox selection scopes the adaptive pool server-side.
      // Full selection sends no filter (identical + keeps idempotency reuse).
      const payload: { count: number; conceptIds?: string[] } =
        partialSelection
          ? { count: clampedForSelection, conceptIds: [...selectedIds] }
          : { count: clampQuizCount(quizCount) };
      const res = await fetch(`/api/projects/${projectId}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate quiz");
      const aq: ActiveQuiz = { quiz: data.quiz, questions: data.questions };
      setActiveQuiz(aq);
      setCurrentIdx(0);
      setResults({});
      setSelectedOption("");
      setOpenResponse("");
      setShowFeedback(false);
      setQuizCompleted(false);
      // (Re)start the practice timer for the new round.
      setQuizStartAt(Date.now());
      setElapsedSec(0);
      setTimeUp(false);
      fetchQuizzes();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setGenerating(false);
    }
  };

  // Deep-link autostart from the Tutor setup dialog (?count=N&start=1) —
  // fires once with the pre-selected count (StrictMode-safe via ref).
  useEffect(() => {
    if (autostart && !autoStartedRef.current) {
      autoStartedRef.current = true;
      startQuiz();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadQuiz = async (quizId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/quiz/${quizId}?answers=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load quiz");
      const aq: ActiveQuiz = { quiz: data.quiz, questions: data.questions };
      setActiveQuiz(aq);
      const ansList: AnswerRecord[] = (data.answers ?? []) as AnswerRecord[];
      const map: Record<string, AnswerRecord> = {};
      for (const a of ansList) map[a.question_id] = a;
      setResults(map);
      const answeredCount = ansList.length;
      const total = aq.questions.length;
      const isCompleted = aq.quiz.status === "completed" || answeredCount >= total;
      setQuizCompleted(isCompleted);
      if (isCompleted) {
        setCurrentIdx(total); // go to summary
      } else {
        // Jump to first unanswered
        let firstUnanswered = 0;
        for (let i = 0; i < total; i++) {
          if (!map[aq.questions[i].id]) {
            firstUnanswered = i;
            break;
          }
        }
        setCurrentIdx(firstUnanswered);
      }
      setSelectedOption("");
      setOpenResponse("");
      setShowFeedback(false);
      // Reviewing history — timer is for live practice only.
      setQuizStartAt(null);
      setElapsedSec(0);
      setTimeUp(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  };

  const currentQuestion = activeQuiz?.questions[currentIdx] ?? null;
  const total = activeQuiz?.questions.length ?? 0;
  const isLast = currentIdx === total - 1;
  const currentResult = currentQuestion ? results[currentQuestion.id] ?? null : null;

  const submitCurrent = async () => {
    if (!currentQuestion || !activeQuiz) return;
    const response = currentQuestion.type === "MCQ" ? selectedOption : openResponse.trim();
    if (!response) {
      setError("Please provide an answer before continuing.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${activeQuiz.quiz.project_id}/quiz/${activeQuiz.quiz.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: currentQuestion.id, response }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit answer");
      const ans: AnswerRecord = data.answer as AnswerRecord;
      const newResults = { ...results, [currentQuestion.id]: ans };
      setResults(newResults);
      // Merge post-answer disclosure (correct_answer/explanation for this
      // question only) into the question so feedback can show "Expected:".
      if (data.correct_answer !== undefined || data.explanation !== undefined) {
        setActiveQuiz((prev) =>
          prev
            ? {
                ...prev,
                questions: prev.questions.map((q) =>
                  q.id === currentQuestion.id
                    ? { ...q, correct_answer: data.correct_answer ?? null, explanation: data.explanation ?? null, answered: true }
                    : q
                ),
              }
            : prev
        );
      }
      setShowFeedback(true);
      if (data.quizCompleted || data.quizStatus === "completed") {
        setQuizCompleted(true);
      }
      // MCQ vs open-ended feedback both shown inline; user clicks Next to advance
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    if (!activeQuiz) return;
    if (!currentResult) {
      // Not yet submitted — submit first
      submitCurrent();
      return;
    }
    // Already have feedback — advance
    setShowFeedback(false);
    if (isLast) {
      setQuizCompleted(true);
      setCurrentIdx(total); // summary
      fetchQuizzes();
    } else {
      setCurrentIdx(currentIdx + 1);
      setSelectedOption("");
      setOpenResponse("");
      setShowFeedback(false);
      // If next question already answered (resume), show its feedback immediately
      const nextQ = activeQuiz.questions[currentIdx + 1];
      if (nextQ && results[nextQ.id]) setShowFeedback(true);
    }
  };

  const handlePrev = () => {
    if (currentIdx > 0) {
      setCurrentIdx(currentIdx - 1);
      const prevQ = activeQuiz!.questions[currentIdx - 1];
      if (prevQ) {
        const prevAns = results[prevQ.id];
        if (prevQ.type === "MCQ") {
          setSelectedOption(prevAns?.response ?? "");
          setOpenResponse("");
        } else {
          setOpenResponse(prevAns?.response ?? "");
          setSelectedOption("");
        }
        setShowFeedback(!!prevAns);
      }
      setError(null);
    }
  };

  const resetToList = () => {
    setActiveQuiz(null);
    setCurrentIdx(0);
    setResults({});
    setSelectedOption("");
    setOpenResponse("");
    setError(null);
    setShowFeedback(false);
    setQuizCompleted(false);
    setQuizStartAt(null);
    setElapsedSec(0);
    setTimeUp(false);
    fetchQuizzes();
  };

  // Summary view after all answered or last submitted
  if (activeQuiz && (currentIdx >= total || quizCompleted && Object.keys(results).length >= total)) {
    const answered = Object.keys(results).length;
    const mcqResults = activeQuiz.questions.map((q) => results[q.id]).filter(Boolean) as AnswerRecord[];
    const avgScore =
      mcqResults.length > 0 ? Math.round(mcqResults.reduce((s, r) => s + (r.score ?? 0), 0) / mcqResults.length) : 0;
    const correctCount = mcqResults.filter((r) => r.is_correct).length;
    const done = activeQuiz.quiz.status === "completed" || quizCompleted;
    return (
      <div className="fade-enter w-full space-y-5">
        <button onClick={resetToList} className="text-sm text-stone-500 transition-colors hover:text-stone-900">
          ← All quizzes
        </button>

        {timeUp && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            Time&apos;s up — showing what you answered in time. Nothing was auto-submitted.
          </div>
        )}
        <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-card sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">Your score</p>
          <p className="tnum mt-2 text-5xl font-semibold tracking-tight text-stone-900">{avgScore}<span className="text-2xl text-stone-400">%</span></p>
          <p className="mt-2 text-sm text-stone-500">{correctCount} of {total} correct · {answered} answered</p>
          {(quizStartAt !== null || elapsedSec > 0) && (
            <p className="tnum mt-1 text-xs text-stone-400">Time taken: {formatClock(elapsedSec)}{timeLimitMin > 0 ? ` of ${timeLimitMin}:00` : ""}</p>
          )}
          <div className="mt-3 flex justify-center">
            <Badge tone={done ? "success" : "warning"}>{done ? "completed" : "in progress"}</Badge>
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button onClick={startQuiz} disabled={generating}>
              {generating ? "Generating…" : "New adaptive quiz"}
            </Button>
            <LinkButton href={`/projects/${projectId}/tutor`} variant="secondary">
              Discuss with tutor
            </LinkButton>
          </div>
          <p className="mx-auto mt-4 max-w-md text-xs text-stone-400">
            MCQ graded by exact match · open-ended graded by AI. Results feed concept mastery and your next quiz adapts to them.
          </p>
        </div>

        <div className="space-y-3">
          {activeQuiz.questions.map((q, idx) => {
            const r = results[q.id];
            return (
              <div key={q.id} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-card">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-100 text-xs font-semibold text-stone-700">{idx + 1}</span>
                  <Badge tone="neutral">{q.difficulty}</Badge>
                  <Badge tone="accent">{q.type === "MCQ" ? "Multiple choice" : "Open ended"}</Badge>
                  {q.concept_name && <span className="text-xs text-stone-400">{q.concept_name}</span>}
                  {r && r.is_correct !== null && (
                    <Badge tone={r.is_correct ? "success" : "danger"}>{r.is_correct ? "Correct" : "Incorrect"}</Badge>
                  )}
                  {r && r.score !== null && <span className="tnum text-xs text-stone-500">{r.score}%</span>}
                </div>
                <p className="text-[15px] font-medium leading-relaxed text-stone-900">{q.question}</p>
                {q.type === "MCQ" && q.options && (
                  <ul className="mt-3 space-y-1.5">
                    {q.options.map((opt, i) => {
                      const isCorrect = opt === q.correct_answer;
                      const isYours = r?.response === opt;
                      return (
                        <li
                          key={i}
                          className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-sm ${
                            isCorrect
                              ? "border-green-600/40 bg-green-50 font-medium text-stone-900"
                              : isYours
                                ? "border-red-300 bg-red-50 text-stone-800"
                                : "border-stone-100 text-stone-500"
                          }`}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-stone-500 ring-1 ring-inset ring-stone-200">
                            {OPTION_LETTERS[i] ?? i + 1}
                          </span>
                          <span className="flex-1">{opt}</span>
                          {isCorrect && <span className="text-xs font-medium text-green-700">Correct</span>}
                          {!isCorrect && isYours && <span className="text-xs font-medium text-red-600">Yours</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {q.type === "OPEN_ENDED" && q.correct_answer && (
                  <p className="mt-3 text-xs text-stone-400">Reference: {q.correct_answer}</p>
                )}
                <p className="mt-3 text-sm text-stone-700">
                  <span className="font-medium text-stone-900">Your answer:</span>{" "}
                  {r ? r.response : <span className="text-stone-400">no response</span>}
                </p>
                {r?.evaluation ? (
                  <div className="mt-3 space-y-1.5 rounded-xl bg-stone-50 p-4 text-sm">
                    <p className="text-stone-800"><span className="font-medium">Feedback:</span> {r.evaluation.feedback}</p>
                    <p className="text-xs text-stone-500"><span className="font-medium">Understanding:</span> {r.evaluation.understanding}</p>
                    {r.evaluation.strengths.length > 0 && (
                      <p className="text-xs text-stone-500"><span className="font-medium">Strengths:</span> {r.evaluation.strengths.join("; ")}</p>
                    )}
                    {r.evaluation.missingConcepts.length > 0 && (
                      <p className="text-xs text-amber-700"><span className="font-medium">Missing:</span> {r.evaluation.missingConcepts.join("; ")}</p>
                    )}
                  </div>
                ) : (
                  r && q.explanation && <p className="mt-2 text-xs text-stone-400">Explanation: {q.explanation}</p>
                )}
                {!r && <p className="mt-2 text-xs text-amber-600">Not yet answered — open the quiz and submit to grade.</p>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (activeQuiz && currentQuestion) {
    const alreadyAnswered = !!currentResult;
    const isMcq = currentQuestion.type === "MCQ";
    const answeredFlags = activeQuiz.questions.map((q) => !!results[q.id]);
    return (
      <div className="fade-enter w-full space-y-4">
        <div className="flex items-center justify-between gap-2">
          <button onClick={resetToList} className="text-sm text-stone-500 transition-colors hover:text-stone-900">
            ← All quizzes
          </button>
          <div className="flex items-center gap-2">
            {quizStartAt !== null && (
              <span
                className={`tnum rounded-full px-2.5 py-1 text-xs font-semibold ${
                  timeLeftSec !== null && timeLeftSec <= 60 ? "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200" : "bg-stone-100 text-stone-600"
                }`}
                title={timeLimitMin > 0 ? `Time left: ${formatClock(timeLeftSec ?? 0)}` : "Elapsed time (practice only)"}
                aria-live="off"
              >
                ⏱ {formatClock(elapsedSec)}{timeLeftSec !== null ? ` left` : ""}
              </span>
            )}
            <span className="tnum text-sm text-stone-500">
              {currentIdx + 1} / {total}
            </span>
          </div>
        </div>
        <StepDots total={total} current={currentIdx} answered={answeredFlags} />

        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-card sm:p-8">
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <Badge
              tone={
                currentQuestion.difficulty === "easy"
                  ? "success"
                  : currentQuestion.difficulty === "medium"
                    ? "warning"
                    : "danger"
              }
            >
              {currentQuestion.difficulty}
            </Badge>
            <Badge tone="accent">{currentQuestion.type === "MCQ" ? "Multiple choice" : "Open ended"}</Badge>
            {currentQuestion.concept_name && (
              <span className="text-xs text-stone-400" title="Picked for you based on mastery">
                {currentQuestion.concept_name} · adapted to you
              </span>
            )}
            {alreadyAnswered && currentResult?.is_correct !== null && (
              <Badge tone={currentResult.is_correct ? "success" : "danger"}>
                {currentResult.is_correct ? "Correct" : "Incorrect"}
              </Badge>
            )}
          </div>
          <h3 className="mb-5 text-lg font-medium leading-relaxed text-stone-900">{currentQuestion.question}</h3>

          {isMcq ? (
            <div className="space-y-2.5" role="radiogroup" aria-label="Answer options">
              {(currentQuestion.options ?? []).map((opt, idx) => {
                const isSelected = selectedOption === opt;
                const isResponse = alreadyAnswered && currentResult?.response === opt;
                const showVerdict = alreadyAnswered && currentResult?.is_correct !== null;
                const verdictGood = showVerdict && opt === currentQuestion.correct_answer;
                const verdictBad = showVerdict && isResponse && !currentResult?.is_correct;
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
                      name="mcq-option"
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
          ) : (
            <div>
              <textarea
                value={alreadyAnswered ? currentResult?.response ?? openResponse : openResponse}
                onChange={(e) => !alreadyAnswered && setOpenResponse(e.target.value)}
                placeholder="Type your answer here…"
                rows={4}
                disabled={alreadyAnswered}
                className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-[15px] focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600 disabled:bg-stone-50"
              />
              <p className="mt-2 text-xs text-stone-400">Open-ended — graded by AI for score and feedback.</p>
            </div>
          )}

          {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

          {showFeedback && currentResult && (
            <div className={`mt-5 rounded-2xl border p-5 ${currentResult.is_correct ? "border-green-600/30 bg-green-50" : currentResult.score !== null && currentResult.score < 60 ? "border-amber-200 bg-amber-50" : "border-stone-200 bg-stone-50"}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`text-[15px] font-semibold ${currentResult.is_correct ? "text-green-700" : "text-stone-900"}`}>{isMcq ? (currentResult.is_correct ? "Correct — nice work" : "Not quite") : `Score: ${currentResult.score}%`}</span>
                {currentResult.score !== null && <span className="tnum text-xs text-stone-500">({currentResult.score}/100)</span>}
                {currentResult.evaluation && (
                  <Badge tone={currentResult.evaluation.reasoningQuality === "strong" ? "success" : currentResult.evaluation.reasoningQuality === "partial" ? "warning" : "danger"}>reasoning: {currentResult.evaluation.reasoningQuality}</Badge>
                )}
              </div>
              {currentResult.evaluation ? (
                <div className="space-y-1.5 text-sm">
                  <p className="text-stone-800"><span className="font-medium">Feedback:</span> {currentResult.evaluation.feedback}</p>
                  <p className="text-xs text-stone-500"><span className="font-medium">Understanding:</span> {currentResult.evaluation.understanding}</p>
                  {currentResult.evaluation.strengths.length > 0 && (
                    <p className="text-xs text-stone-500"><span className="font-medium">Strengths:</span> {currentResult.evaluation.strengths.join("; ")}</p>
                  )}
                  {currentResult.evaluation.missingConcepts.length > 0 && (
                    <p className="text-xs text-amber-700"><span className="font-medium">Missing concepts:</span> {currentResult.evaluation.missingConcepts.join("; ")}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-stone-700">
                  {currentResult.is_correct
                    ? "Well done — your answer matches the expected answer."
                    : currentQuestion.correct_answer
                      ? `Expected: ${currentQuestion.correct_answer}`
                      : "Not quite — review the material and try again."}
                </p>
              )}
              {currentQuestion.explanation && <p className="mt-2 text-xs text-stone-400">Explanation: {currentQuestion.explanation}</p>}
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
              <Button
                onClick={submitCurrent}
                disabled={submitting || (!isMcq && !openResponse.trim()) || (isMcq && !selectedOption)}
                className="min-w-32"
              >
                {submitting && <Spinner className="text-white" />}
                {submitting ? "Grading…" : "Check answer"}
                {!submitting && <ArrowRightIcon className="h-4 w-4" />}
              </Button>
            ) : (
              <Button onClick={handleNext} className="min-w-32">
                {isLast ? (quizCompleted ? "View results" : "Finish") : "Next question"}
                <ArrowRightIcon className="h-4 w-4" />
              </Button>
            )}
          </div>
          {submitting && <p className="mt-2 text-center text-xs text-stone-400">{isMcq ? "Grading…" : "Grading with AI…"}</p>}
        </div>

        <p className="text-center text-xs text-stone-400">
          Each answer updates mastery — your next quiz adapts to what you just showed.
        </p>
      </div>
    );
  }

  // List view
  return (
    <div className="fade-enter w-full space-y-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-card sm:p-8">
        <div className="flex items-start gap-4">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-600 text-white">
            <QuizIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-stone-900">Adaptive quiz</h2>
            <p className="mt-1 text-sm leading-relaxed text-stone-500">
              Questions per round, picked from your weakest concepts and recent mistakes. Difficulty adapts to your mastery — answer well and it gets harder.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-1.5 py-1" aria-label="Number of questions">
                <button
                  type="button"
                  onClick={() => setQuizCount((c) => clampQuizCount(c - 1))}
                  disabled={generating || quizCount <= QUIZ_MIN_COUNT}
                  aria-label="Fewer questions"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-base font-semibold text-stone-600 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  −
                </button>
                <span className="tnum min-w-16 text-center text-sm font-semibold text-stone-900" aria-live="polite">
                  {quizCount} {quizCount === 1 ? "question" : "questions"}
                </span>
                <button
                  type="button"
                  onClick={() => setQuizCount((c) => clampQuizCount(c + 1))}
                  disabled={generating || quizCount >= QUIZ_MAX_COUNT}
                  aria-label="More questions"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-base font-semibold text-stone-600 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  +
                </button>
              </div>
              <label className="flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm" title="Optional countdown per round (practice only)">
                <span aria-hidden>⏱</span>
                <span className="sr-only">Time limit</span>
                <select
                  value={timeLimitMin}
                  onChange={(e) => setTimeLimitMin(Number(e.target.value))}
                  disabled={generating}
                  aria-label="Time limit"
                  className="bg-transparent text-sm font-medium text-stone-700 focus:outline-none"
                >
                  {TIME_LIMIT_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? "No limit" : `${m} min`}
                    </option>
                  ))}
                </select>
              </label>
              <Button onClick={startQuiz} disabled={generating || (totalTopics > 0 && selectedCount === 0)}>
                {generating && <Spinner className="text-white" />}
                {generating ? "Building your quiz…" : partialSelection ? `Start quiz (${clampedForSelection}q)` : "Start quiz"}
              </Button>
              <LinkButton href={`/projects/${projectId}/tutor`} variant="secondary">
                Ask tutor first
              </LinkButton>
            </div>
            {/* Topic scope picker — checkboxes grouped by material */}
            <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-stone-900">
                  Topics{" "}
                  <span className="tnum font-normal text-stone-500" aria-live="polite">
                    {totalTopics > 0 ? `${selectedCount} of ${totalTopics} selected` : ""}
                  </span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={selectAll} disabled={generating || conceptsLoading || totalTopics === 0} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-200 transition-colors hover:bg-stone-100 disabled:opacity-40">
                    All
                  </button>
                  <button type="button" onClick={selectWeak} disabled={generating || conceptsLoading || totalTopics === 0} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-200 transition-colors hover:bg-stone-100 disabled:opacity-40" title="Weak (<50%) + untested">
                    Weak only
                  </button>
                  <button type="button" onClick={selectUntested} disabled={generating || conceptsLoading || totalTopics === 0} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-200 transition-colors hover:bg-stone-100 disabled:opacity-40">
                    Untested
                  </button>
                  <button type="button" onClick={clearAll} disabled={generating || conceptsLoading || selectedCount === 0} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-200 transition-colors hover:bg-stone-100 disabled:opacity-40">
                    Clear
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-stone-500">
                Mixed across all your materials — untick anything to exclude it. Adaptive difficulty still picks your weakest within the selection.
              </p>
              {partialSelection && (
                <p className="mt-1 text-xs text-sky-700">
                  Only {selectedCount} topic{selectedCount === 1 ? "" : "s"} selected — you&apos;ll get up to {clampedForSelection} question{clampedForSelection === 1 ? "" : "s"} (1 per topic).
                </p>
              )}
              {totalTopics > 6 && (
                <input
                  type="search"
                  value={topicSearch}
                  onChange={(e) => setTopicSearch(e.target.value)}
                  placeholder="Filter topics…"
                  aria-label="Filter topics"
                  className="mt-2.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
              )}
              <div className="mt-2.5">
                {conceptsLoading ? (
                  <div className="space-y-2" aria-label="Loading topics">
                    <div className="skeleton h-10 w-full rounded-lg" />
                    <div className="skeleton h-10 w-11/12 rounded-lg" />
                  </div>
                ) : conceptsError ? (
                  <p className="text-xs text-amber-700">
                    Couldn&apos;t load topics ({conceptsError}) — quiz will use all topics.{" "}
                    <button onClick={fetchConcepts} className="font-medium underline">Retry</button>
                  </p>
                ) : totalTopics === 0 ? (
                  <p className="text-xs text-stone-500">No topics yet — upload and process a PDF first. Quiz will use adaptive defaults.</p>
                ) : grouped.length === 0 ? (
                  <p className="text-xs text-stone-500">No topics match &quot;{topicSearch}&quot;.</p>
                ) : (
                  <ul className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
                    {grouped.map((g) => {
                      const allOn = g.items.every((c) => selectedIds.has(c.conceptId));
                      const someOn = !allOn && g.items.some((c) => selectedIds.has(c.conceptId));
                      const isCollapsed = collapsed[g.key] ?? false;
                      return (
                        <li key={g.key} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
                          <div className="flex items-center gap-2.5 px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={allOn}
                              ref={(el) => {
                                if (el) el.indeterminate = someOn;
                              }}
                              onChange={() => toggleMaterial(g.items)}
                              disabled={generating}
                              aria-label={`Select all topics from ${g.materialName}`}
                              className="h-4 w-4 shrink-0 accent-sky-600"
                            />
                            <button
                              type="button"
                              onClick={() => setCollapsed((p) => ({ ...p, [g.key]: !isCollapsed }))}
                              aria-expanded={!isCollapsed}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-stone-800" title={g.materialName}>
                                {g.materialName}
                              </span>
                              <span className="tnum shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-500">
                                {g.items.filter((c) => selectedIds.has(c.conceptId)).length}/{g.items.length}
                              </span>
                              <span aria-hidden className={`text-xs text-stone-400 transition-transform ${isCollapsed ? "" : "rotate-180"}`}>▾</span>
                            </button>
                          </div>
                          {!isCollapsed && (
                            <ul className="space-y-0.5 border-t border-stone-100 px-3 py-2">
                              {g.items.map((c) => {
                                const on = selectedIds.has(c.conceptId);
                                return (
                                  <li key={c.conceptId}>
                                    <label className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${on ? "hover:bg-sky-50" : "opacity-70 hover:bg-stone-100"}`}>
                                      <input
                                        type="checkbox"
                                        checked={on}
                                        onChange={() => toggleConcept(c.conceptId)}
                                        disabled={generating}
                                        className="h-4 w-4 shrink-0 accent-sky-600"
                                      />
                                      <span className="min-w-0 flex-1 truncate text-[13px] text-stone-800" title={c.description ?? c.conceptName}>
                                        {c.conceptName}
                                      </span>
                                      <Badge tone={topicTone(c.currentScore)}>{topicLabel(c.currentScore)}</Badge>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
            {generating && <p className="mt-2 text-xs text-stone-400">Picking from your selected topics by mastery + generating questions…</p>}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-stone-900">History</h3>
          <button onClick={fetchQuizzes} className="text-xs font-medium text-stone-500 transition-colors hover:text-stone-900">
            Refresh
          </button>
        </div>
        {fetching ? (
          <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading quizzes">
            <div className="skeleton h-12 w-full" />
            <div className="skeleton h-12 w-full" />
            <div className="skeleton h-12 w-2/3" />
          </div>
        ) : quizzes.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-stone-100 text-stone-500">
              <QuizIcon className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-stone-900">No quizzes yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">Start your first round above — needs at least one processed PDF with concepts.</p>
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {quizzes.map((q) => (
              <li key={q.id}>
                <button onClick={() => loadQuiz(q.id)} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-stone-50">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-stone-900">
                      Quiz {q.id.slice(0, 8)}
                      <Badge tone={q.status === "completed" ? "success" : "warning"}>{q.status}</Badge>
                    </p>
                    <p className="mt-0.5 text-xs text-stone-400">{formatDateTime(q.created_at)}</p>
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
