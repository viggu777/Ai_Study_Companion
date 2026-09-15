"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Spinner } from "@/components/ui";
import { QuizIcon } from "@/components/icons";

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
  correct_answer: string | null;
  explanation: string | null;
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
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">Quiz Summary</h2>
          <button onClick={resetToList} className="text-sm text-emerald-700 hover:text-emerald-800">
            Back to quizzes
          </button>
        </div>
        <div className="bg-white rounded-lg shadow-card border border-stone-200 p-4">
          <div className="mb-4 p-3 bg-stone-50 rounded-lg border border-stone-200 flex flex-wrap gap-4 text-sm">
            <span>
              <span className="font-medium">Answered:</span> {answered} / {total}
            </span>
            <span>
              <span className="font-medium">Correct (MCQ ≥60):</span> {correctCount} / {total}
            </span>
            <span>
              <span className="font-medium">Avg score:</span> {avgScore}%
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${activeQuiz.quiz.status === "completed" || quizCompleted ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
              {activeQuiz.quiz.status === "completed" || quizCompleted ? "completed" : "in progress"}
            </span>
          </div>
          <p className="text-xs text-stone-500 mb-4">MCQ graded deterministically (exact match). Open-ended graded by AI — score, reasoning, and feedback shown per question.</p>
          <div className="space-y-4">
            {activeQuiz.questions.map((q, idx) => {
              const r = results[q.id];
              return (
                <div key={q.id} className="border border-stone-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-stone-500">Q{idx + 1}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-700">{q.difficulty}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">{q.type}</span>
                    <span className="text-xs text-stone-500">{q.concept_name}</span>
                    {r && r.is_correct !== null && (
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${r.is_correct ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{r.is_correct ? "correct" : "incorrect"}</span>
                    )}
                    {r && r.score !== null && <span className="text-xs text-stone-700">score: {r.score}%</span>}
                    {r && r.evaluation && (
                      <span className={`text-xs px-2 py-0.5 rounded ${r.evaluation.reasoningQuality === "strong" ? "bg-green-50 text-green-700" : r.evaluation.reasoningQuality === "partial" ? "bg-yellow-50 text-yellow-700" : "bg-red-50 text-red-700"}`}>reasoning: {r.evaluation.reasoningQuality}</span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-stone-900 mb-2">{q.question}</p>
                  {q.type === "MCQ" && q.options && (
                    <ul className="text-sm text-stone-700 list-disc list-inside mb-2">
                      {q.options.map((opt, i) => (
                        <li key={i} className={opt === q.correct_answer ? "font-semibold text-green-700" : ""}>
                          {opt} {opt === q.correct_answer && " (correct)"}
                        </li>
                      ))}
                    </ul>
                  )}
                  {q.type === "OPEN_ENDED" && q.correct_answer && (
                    <p className="text-xs text-stone-500 mb-2">Reference: {q.correct_answer}</p>
                  )}
                  <p className="text-sm">
                    <span className="font-medium">Your answer:</span> {r ? r.response : <span className="text-stone-400">no response</span>}
                  </p>
                  {r?.evaluation ? (
                    <div className="mt-3 bg-stone-50 rounded p-3 border border-stone-200 space-y-2">
                      <p className="text-sm text-stone-800">
                        <span className="font-medium">Feedback:</span> {r.evaluation.feedback}
                      </p>
                      <p className="text-xs text-stone-600">
                        <span className="font-medium">Understanding:</span> {r.evaluation.understanding}
                      </p>
                      {r.evaluation.strengths.length > 0 && (
                        <p className="text-xs text-stone-600">
                          <span className="font-medium">Strengths:</span> {r.evaluation.strengths.join("; ")}
                        </p>
                      )}
                      {r.evaluation.missingConcepts.length > 0 && (
                        <p className="text-xs text-amber-700">
                          <span className="font-medium">Missing:</span> {r.evaluation.missingConcepts.join("; ")}
                        </p>
                      )}
                    </div>
                  ) : (
                    r && q.explanation && <p className="text-xs text-stone-500 mt-2">Explanation: {q.explanation}</p>
                  )}
                  {!r && <p className="text-xs text-amber-600 mt-2">Not yet answered — open the quiz and submit to grade.</p>}
                </div>
              );
            })}
          </div>
          <div className="mt-6 flex gap-2">
            <button onClick={resetToList} className="bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-800">
              Back to quizzes
            </button>
            <button onClick={startQuiz} disabled={generating} className="bg-white border border-stone-300 text-stone-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-stone-50 disabled:opacity-50">
              {generating ? "Generating..." : "Start New Quiz"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeQuiz && currentQuestion) {
    const alreadyAnswered = !!currentResult;
    const isMcq = currentQuestion.type === "MCQ";
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={resetToList} className="text-sm text-emerald-700 hover:text-emerald-800">
            ← Back to quizzes
          </button>
          <span className="text-sm text-stone-500">
            Question {currentIdx + 1} of {total}
          </span>
        </div>

        <div className="fade-enter rounded-xl border border-stone-200 bg-white p-6 shadow-card">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
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
            <Badge tone="accent">{currentQuestion.type}</Badge>
            <span className="text-xs text-stone-500">{currentQuestion.concept_name}</span>
            {alreadyAnswered && currentResult?.is_correct !== null && (
              <Badge tone={currentResult.is_correct ? "success" : "danger"}>
                {currentResult.is_correct ? "correct" : "incorrect"}
              </Badge>
            )}
          </div>
          <h3 className="text-base font-medium text-stone-900 mb-4">{currentQuestion.question}</h3>

          {isMcq ? (
            <div className="space-y-2">
              {(currentQuestion.options ?? []).map((opt, idx) => {
                const isSelected = selectedOption === opt;
                const isResponse = alreadyAnswered && currentResult?.response === opt;
                const showVerdict = alreadyAnswered && currentResult?.is_correct !== null;
                const verdictGood = showVerdict && opt === currentQuestion.correct_answer;
                const verdictBad = showVerdict && isResponse && !currentResult?.is_correct;
                return (
                  <label
                    key={idx}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-all ${
                      verdictGood
                        ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600"
                        : verdictBad
                          ? "border-red-300 bg-red-50"
                          : isSelected
                            ? "border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-600"
                            : "border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50"
                    } ${alreadyAnswered ? "cursor-default" : ""}`}
                  >
                    <span
                      aria-hidden
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        verdictGood || (isSelected && !alreadyAnswered)
                          ? "border-emerald-600"
                          : verdictBad
                            ? "border-red-400"
                            : "border-stone-300"
                      }`}
                    >
                      {(verdictGood || isSelected || isResponse) && (
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            verdictBad ? "bg-red-400" : "bg-emerald-600"
                          }`}
                        />
                      )}
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
                    <span className="text-sm text-stone-900">{opt}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div>
              <textarea
                value={alreadyAnswered ? currentResult?.response ?? openResponse : openResponse}
                onChange={(e) => !alreadyAnswered && setOpenResponse(e.target.value)}
                placeholder="Type your answer here..."
                rows={4}
                disabled={alreadyAnswered}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-stone-50"
              />
              <p className="text-xs text-stone-400 mt-2">Open-ended — graded by AI for score and feedback.</p>
            </div>
          )}

          {error && <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

          {showFeedback && currentResult && (
            <div className={`mt-4 rounded-lg border p-4 ${currentResult.is_correct ? "bg-green-50 border-green-200" : currentResult.score !== null && currentResult.score < 60 ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-sm font-semibold ${currentResult.is_correct ? "text-green-700" : "text-stone-800"}`}>{isMcq ? (currentResult.is_correct ? "Correct!" : "Incorrect") : `Score: ${currentResult.score}%`}</span>
                {currentResult.score !== null && <span className="text-xs text-stone-600">({currentResult.score}/100)</span>}
                {currentResult.evaluation && (
                  <span className={`text-xs px-2 py-0.5 rounded ${currentResult.evaluation.reasoningQuality === "strong" ? "bg-green-100 text-green-700" : currentResult.evaluation.reasoningQuality === "partial" ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>reasoning: {currentResult.evaluation.reasoningQuality}</span>
                )}
              </div>
              {currentResult.evaluation ? (
                <div className="space-y-2 text-sm">
                  <p className="text-stone-800">
                    <span className="font-medium">Feedback:</span> {currentResult.evaluation.feedback}
                  </p>
                  <p className="text-xs text-stone-600">
                    <span className="font-medium">Understanding:</span> {currentResult.evaluation.understanding}
                  </p>
                  {currentResult.evaluation.strengths.length > 0 && (
                    <p className="text-xs text-stone-600">
                      <span className="font-medium">Strengths:</span> {currentResult.evaluation.strengths.join("; ")}
                    </p>
                  )}
                  {currentResult.evaluation.missingConcepts.length > 0 && (
                    <p className="text-xs text-amber-700">
                      <span className="font-medium">Missing concepts:</span> {currentResult.evaluation.missingConcepts.join("; ")}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-stone-700">
                  {currentResult.is_correct ? "Well done — your answer matches the expected answer." : `Expected: ${currentQuestion.correct_answer}`}
                </p>
              )}
              {currentQuestion.explanation && <p className="text-xs text-stone-500 mt-2">Explanation: {currentQuestion.explanation}</p>}
            </div>
          )}

          <div className="mt-6 flex justify-between">
            <button
              onClick={handlePrev}
              disabled={currentIdx === 0}
              className="px-4 py-2 rounded-lg border border-stone-300 text-sm font-medium text-stone-700 bg-white hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <div className="flex gap-2">
              {!alreadyAnswered && !showFeedback ? (
          <Button
            onClick={submitCurrent}
            disabled={submitting || (!isMcq && !openResponse.trim()) || (isMcq && !selectedOption)}
            className="px-6"
          >
            {submitting && <Spinner className="text-white" />}
            {submitting ? "Grading…" : "Submit"}
          </Button>
              ) : (
                <button onClick={handleNext} className="px-6 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800">
                  {isLast ? (quizCompleted ? "View summary" : "Finish") : "Next"}
                </button>
              )}
            </div>
          </div>
          <div className="mt-4 w-full bg-stone-200 rounded-full h-2">
            <div className="bg-emerald-700 h-2 rounded-full transition-all" style={{ width: `${((currentIdx + 1) / total) * 100}%` }} />
          </div>
          {submitting && <p className="text-xs text-stone-500 mt-2 text-center">{isMcq ? "Grading deterministically..." : "Grading via Meta Llama API..."}</p>}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-card border border-stone-200 p-6">
        <h2 className="text-lg font-semibold text-stone-900 mb-2">Adaptive Quiz</h2>
        <p className="text-sm text-stone-600 mb-4">
          Generates 5 questions per quiz, weighted by: low mastery → higher priority, recent mistakes, declining trend, and recency/frequency. Weaker and recently-missed concepts appear more often; difficulty and type (MCQ vs open-ended) adapt to the same signals.
        </p>
        <button
          onClick={startQuiz}
          disabled={generating}
          className="bg-emerald-700 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? "Generating..." : "Start Quiz"}
        </button>
        {error && <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
        {generating && <p className="text-xs text-stone-500 mt-2">Generating via Meta Llama API — scoring concepts + calling structured generation...</p>}
      </div>

      <div className="bg-white rounded-lg shadow-card border border-stone-200">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900">Recent Quizzes</h3>
          <button onClick={fetchQuizzes} className="text-xs text-emerald-700 hover:text-emerald-800">
            Refresh
          </button>
        </div>
        {fetching ? (
          <div className="space-y-3 p-6" aria-busy="true" aria-label="Loading quizzes">
            <div className="skeleton h-11 w-full" />
            <div className="skeleton h-11 w-full" />
            <div className="skeleton h-11 w-2/3" />
          </div>
        ) : quizzes.length === 0 ? (
          <div className="p-6 text-center">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-700/[0.08] text-emerald-800">
              <QuizIcon className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-stone-900">No quizzes yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">Click Start Quiz to generate your first adaptive quiz.</p>
            <p className="text-xs text-stone-400 mt-2">Requires at least one processed material with concepts extracted.</p>
          </div>
        ) : (
          <ul className="divide-y divide-stone-200">
            {quizzes.map((q) => (
              <li key={q.id} className="px-6 py-4 flex items-center justify-between hover:bg-stone-50">
                <div>
                  <p className="text-sm font-medium text-stone-900">{q.id.slice(0, 8)} — {q.status}</p>
                  <p className="text-xs text-stone-500">{new Date(q.created_at).toLocaleString()}</p>
                </div>
                <button onClick={() => loadQuiz(q.id)} className="text-sm text-emerald-700 hover:text-emerald-800">
                  View
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
