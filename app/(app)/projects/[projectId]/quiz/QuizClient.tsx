"use client";

import { useEffect, useState } from "react";
import { Badge, Button, LinkButton, Spinner } from "@/components/ui";
import { formatDateTime } from "@/lib/datetime";
import { QuizIcon, ArrowRightIcon } from "@/components/icons";

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

export default function QuizClient({ projectId }: { projectId: string }) {
  const [quizzes, setQuizzes] = useState<QuizListItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeQuiz, setActiveQuiz] = useState<ActiveQuiz | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string>("");
  const [openResponse, setOpenResponse] = useState<string>("");
  const [results, setResults] = useState<Record<string, AnswerRecord>>({});
  const [submitting, setSubmitting] = useState(false);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

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

  const startQuiz = async () => {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 5 }),
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
      fetchQuizzes();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setGenerating(false);
    }
  };

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

        <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-card sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">Your score</p>
          <p className="tnum mt-2 text-5xl font-semibold tracking-tight text-stone-900">{avgScore}<span className="text-2xl text-stone-400">%</span></p>
          <p className="mt-2 text-sm text-stone-500">{correctCount} of {total} correct · {answered} answered</p>
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
        <div className="flex items-center justify-between">
          <button onClick={resetToList} className="text-sm text-stone-500 transition-colors hover:text-stone-900">
            ← All quizzes
          </button>
          <span className="tnum text-sm text-stone-500">
            {currentIdx + 1} / {total}
          </span>
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
              5 questions per round, picked from your weakest concepts and recent mistakes. Difficulty adapts to your mastery — answer well and it gets harder.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={startQuiz} disabled={generating}>
                {generating && <Spinner className="text-white" />}
                {generating ? "Building your quiz…" : "Start quiz"}
              </Button>
              <LinkButton href={`/projects/${projectId}/tutor`} variant="secondary">
                Ask tutor first
              </LinkButton>
            </div>
            {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
            {generating && <p className="mt-2 text-xs text-stone-400">Picking concepts by mastery + generating questions…</p>}
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
