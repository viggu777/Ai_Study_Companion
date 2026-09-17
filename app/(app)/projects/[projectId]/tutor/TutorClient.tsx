"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { Badge, LinkButton } from "@/components/ui";
import { ArrowRightIcon, BookIcon, ChatIcon, QuizIcon, SparkIcon } from "@/components/icons";

interface Citation {
  materialId: string;
  materialName: string;
  page: number;
  chunkId: string;
}

interface TutorResponse {
  answer: string;
  confidence: "high" | "medium" | "low";
  grounded: boolean;
  citations: Citation[];
  followUpSuggestion: string;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  citations: unknown;
  created_at: string;
  parsed?: TutorResponse | null;
  /** local-only navigation card (never persisted server-side) */
  kind?: "quiz-card";
}

function parseAssistant(m: MessageRow): TutorResponse | null {
  if (m.parsed) return m.parsed;
  try {
    return JSON.parse(m.content) as TutorResponse;
  } catch {
    return null;
  }
}

/** "give me a quiz / test me / mock test / practice questions" → go to Quiz page */
function isQuizIntent(text: string): boolean {
  return /\b(quiz|quizzes|test me|mock test|practice(\s+questions)?|assess me)\b/i.test(text);
}

const SUGGESTIONS = [
  "Summarize my PDFs",
  "Give me a quiz",
  "What files do I have?",
  "What are the key concepts?",
];

function TypingDots() {
  return (
    <span className="flex items-center gap-1.5 py-2" aria-label="Generating answer">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 animate-bounce rounded-full bg-stone-400"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

function AssistantAvatar() {
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white"
    >
      <SparkIcon className="h-4 w-4" />
    </span>
  );
}

export default function TutorClient({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sourcePanel, setSourcePanel] = useState<{ citations: Citation[]; index: number } | null>(null);
  const [excerpt, setExcerpt] = useState<string | null>(null);
  const [excerptLoading, setExcerptLoading] = useState(false);
  const [excerptError, setExcerptError] = useState<string | null>(null);
  const excerptCache = useRef<Record<string, string>>({});
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollBottom = () => bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  const fetchHistory = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/tutor`);
      if (!res.ok) throw new Error("Failed to fetch history");
      const data = await res.json();
      setMessages((data.messages ?? []) as MessageRow[]);
    } catch (e) {
      console.error(e);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    scrollBottom();
  }, [messages, loading]);

  // Autogrow the composer (ChatGPT-style), capped at ~5 lines
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [question]);

  const pushQuizCard = (q: string) => {
    const now = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: q, citations: null, created_at: now },
      {
        id: `quiz-card-${Date.now()}`,
        role: "assistant",
        content: "",
        citations: [],
        created_at: now,
        kind: "quiz-card",
      },
    ]);
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = question.trim();
    if (!q || loading) return;
    setError(null);

    // Quiz intent → navigate to the Quiz page instead of asking the tutor
    if (isQuizIntent(q)) {
      setQuestion("");
      pushQuizCard(q);
      return;
    }

    setLoading(true);
    // Optimistic user message
    const tempId = `temp-user-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, role: "user", content: q, citations: null, created_at: new Date().toISOString() }]);
    setQuestion("");

    try {
      const res = await fetch(`/api/projects/${projectId}/tutor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Tutor request failed");

      // data is TutorResponse & { conversationId }
      const assistantMsg: MessageRow = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: JSON.stringify(data),
        citations: data.citations,
        created_at: new Date().toISOString(),
        parsed: data as TutorResponse,
      };
      setMessages((prev) => [...prev.filter((m) => m.id !== tempId), { id: tempId.replace("temp-user", "user"), role: "user", content: q, citations: null, created_at: new Date().toISOString() }, assistantMsg]);
      // Refresh from server to get canonical ids
      fetchHistory();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Keep optimistic user message but remove temp
      setMessages((prev) => prev.filter((m) => m.id !== tempId).concat([{ id: `user-${Date.now()}`, role: "user", content: q, citations: null, created_at: new Date().toISOString() }]));
    } finally {
      setLoading(false);
    }
  };

  const openSources = (citations: Citation[]) => {
    setSourcePanel({ citations, index: 0 });
  };

  const closeSources = () => {
    setSourcePanel(null);
    setExcerpt(null);
    setExcerptError(null);
  };

  // Fetch the chunk excerpt for the selected citation (cached per chunk).
  useEffect(() => {
    if (!sourcePanel) return;
    const cit = sourcePanel.citations[sourcePanel.index];
    if (!cit) return;
    const cached = excerptCache.current[cit.chunkId];
    if (cached !== undefined) {
      setExcerpt(cached);
      setExcerptError(null);
      setExcerptLoading(false);
      return;
    }
    let cancelled = false;
    setExcerpt(null);
    setExcerptError(null);
    setExcerptLoading(true);
    fetch(`/api/chunks/${cit.chunkId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load excerpt");
        return (data.content ?? "") as string;
      })
      .then((text) => {
        if (cancelled) return;
        excerptCache.current[cit.chunkId] = text;
        setExcerpt(text);
      })
      .catch((e) => {
        if (cancelled) return;
        setExcerptError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setExcerptLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourcePanel]);

  const copyAnswer = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((v) => (v === id ? null : v)), 1600);
    } catch {
      // clipboard unavailable — ignore
    }
  };

  const applySuggestion = (s: string) => {
    if (isQuizIntent(s)) {
      pushQuizCard(s);
      return;
    }
    setQuestion(s);
    inputRef.current?.focus();
  };

  if (fetching) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-card" aria-busy="true" aria-label="Loading conversation">
        <div className="w-full space-y-4">
          <div className="skeleton h-10 w-2/3" />
          <div className="ml-auto skeleton h-10 w-1/2" />
          <div className="skeleton h-16 w-3/4" />
        </div>
      </div>
    );
  }

  return (
    <div className="fade-enter flex h-[calc(100dvh-16rem)] min-h-[520px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-card">
      {/* Thread */}
      <div className="flex-1 overflow-y-auto">
        <div className="w-full space-y-6 px-4 py-6 sm:px-6">
          {messages.length === 0 && (
            <div className="py-8 text-center sm:py-12">
              <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-600 text-white">
                <ChatIcon className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-stone-900">
                What do you want to learn today?
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
                Ask anything about your uploaded PDFs — every answer cites the exact page it came from.
              </p>
              <div className="mx-auto mt-6 flex max-w-lg flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => applySuggestion(s)}
                    className="rounded-full border border-stone-200 bg-white px-4 py-2 text-sm text-stone-700 shadow-card transition-colors hover:border-stone-400 hover:bg-stone-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            if (m.role === "user") {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-3xl bg-stone-100 px-5 py-2.5">
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-stone-900">{m.content}</p>
                  </div>
                </div>
              );
            }

            // Local quiz-navigation card
            if (m.kind === "quiz-card") {
              return (
                <div key={m.id} className="flex gap-3">
                  <AssistantAvatar />
                  <div className="min-w-0 flex-1 rounded-2xl border border-stone-200 bg-stone-50 p-5">
                    <div className="flex items-center gap-2">
                      <QuizIcon className="h-5 w-5 text-stone-700" />
                      <p className="text-[15px] font-semibold text-stone-900">Ready for a quiz?</p>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
                      I&apos;ll test you with adaptive questions picked from your weakest concepts — difficulty adjusts to your answers.
                    </p>
                    <div className="mt-4">
                      <LinkButton href={`/projects/${projectId}/quiz`}>
                        Start quiz
                        <ArrowRightIcon className="h-4 w-4" />
                      </LinkButton>
                    </div>
                  </div>
                </div>
              );
            }

            const parsed = parseAssistant(m);
            if (!parsed) {
              return (
                <div key={m.id} className="flex gap-3">
                  <AssistantAvatar />
                  <p className="min-w-0 flex-1 whitespace-pre-wrap text-[15px] leading-relaxed text-stone-800">{m.content}</p>
                </div>
              );
            }
            const isInsufficient = !parsed.grounded && parsed.citations.length === 0;
            return (
              <div key={m.id} className="group flex gap-3">
                <AssistantAvatar />
                <div className="min-w-0 flex-1">
                  <div
                    className={`rounded-2xl px-5 py-4 ${
                      isInsufficient ? "border border-amber-200 bg-amber-50" : "bg-white"
                    }`}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <Badge
                        tone={
                          parsed.confidence === "high"
                            ? "success"
                            : parsed.confidence === "medium"
                              ? "accent"
                              : "warning"
                        }
                      >
                        {parsed.confidence} confidence
                      </Badge>
                      <Badge tone={parsed.grounded ? "success" : "danger"}>
                        {parsed.grounded ? "grounded" : "not grounded"}
                      </Badge>
                      {isInsufficient && <Badge tone="warning">insufficient evidence</Badge>}
                    </div>
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-stone-900">{parsed.answer}</p>
                    {parsed.citations.length > 0 && (
                      <button
                        type="button"
                        onClick={() => openSources(parsed.citations)}
                        className="mt-3 flex w-full items-center gap-2 truncate rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-left text-xs text-stone-600 transition-colors hover:border-sky-600/40 hover:bg-sky-50/50"
                        title="View source excerpts"
                      >
                        <BookIcon className="h-3.5 w-3.5 shrink-0 text-sky-700" />
                        <span className="truncate">
                          Sources ({parsed.citations.length}): {parsed.citations[0].materialName} · p.{parsed.citations[0].page}
                          {parsed.citations.length > 1 && ` +${parsed.citations.length - 1} more`}
                        </span>
                        <span aria-hidden className="ml-auto shrink-0 text-stone-400">›</span>
                      </button>
                    )}
                    {parsed.followUpSuggestion && (
                      <button
                        type="button"
                        onClick={() => applySuggestion(parsed.followUpSuggestion)}
                        className="mt-3 inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-stone-100 px-3.5 py-1.5 text-xs text-stone-700 transition-colors hover:bg-stone-200"
                        title={parsed.followUpSuggestion}
                      >
                        <SparkIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Try: {parsed.followUpSuggestion}</span>
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => copyAnswer(m.id, parsed.answer)}
                      className="rounded-md px-2 py-1 text-xs text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
                    >
                      {copiedId === m.id ? "Copied" : "Copy"}
                    </button>
                    <Link
                      href={`/projects/${projectId}/quiz`}
                      className="rounded-md px-2 py-1 text-xs text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
                    >
                      Quiz me on this
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="flex gap-3">
              <AssistantAvatar />
              <TypingDots />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <div className="w-full px-4 sm:px-6">
          <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700" role="alert">
            {error}
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-stone-200 bg-white">
        <form onSubmit={submit} className="w-full px-4 py-4 sm:px-6">
          <div className="flex items-end gap-2 rounded-[26px] border border-stone-300 bg-white px-4 py-2 shadow-card transition-colors focus-within:border-stone-500">
            <textarea
              ref={inputRef}
              rows={1}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Message your tutor…"
              className="max-h-[140px] flex-1 resize-none bg-transparent py-2 text-[15px] text-stone-900 placeholder:text-stone-400 focus:outline-none"
              disabled={loading}
              aria-label="Message your tutor"
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              aria-label="Send message"
              className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white transition-all hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-200"
            >
              {loading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <ArrowRightIcon className="h-4 w-4" />
              )}
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-stone-400">
            Grounded in your project&apos;s PDFs · Shift + Enter for a new line
          </p>
        </form>
      </div>

      {/* Source detail drawer */}
      {sourcePanel && (
        <>
          <button
            type="button"
            aria-label="Close sources"
            onClick={closeSources}
            className="fixed inset-0 z-40 cursor-default bg-stone-900/30"
          />
          <aside
            aria-label="Source excerpts"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-stone-200 bg-white shadow-card-hover"
          >
            <div className="flex items-center gap-2 border-b border-stone-200 px-5 py-4">
              <BookIcon className="h-4 w-4 text-sky-700" />
              <h2 className="text-sm font-semibold text-stone-900">
                Sources ({sourcePanel.citations.length})
              </h2>
              <button
                type="button"
                onClick={closeSources}
                aria-label="Close"
                className="ml-auto rounded-md px-2 py-1 text-lg leading-none text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
              >
                ×
              </button>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-stone-100 px-5 py-3">
              {sourcePanel.citations.map((c, i) => (
                <button
                  key={c.chunkId + i}
                  type="button"
                  onClick={() => setSourcePanel({ citations: sourcePanel.citations, index: i })}
                  className={`max-w-full truncate rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    i === sourcePanel.index
                      ? "bg-sky-600 text-white"
                      : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                  }`}
                  title={`${c.materialName} · page ${c.page}`}
                >
                  {c.materialName} · p.{c.page}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {(() => {
                const cit = sourcePanel.citations[sourcePanel.index];
                if (!cit) return null;
                return (
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-stone-900">{cit.materialName}</p>
                      <p className="mt-0.5 text-xs text-stone-500">Page {cit.page}</p>
                    </div>
                    {excerptLoading && (
                      <div className="space-y-2" aria-label="Loading excerpt">
                        <div className="skeleton h-4 w-full" />
                        <div className="skeleton h-4 w-11/12" />
                        <div className="skeleton h-4 w-3/4" />
                      </div>
                    )}
                    {excerptError && (
                      <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{excerptError}</p>
                    )}
                    {excerpt !== null && !excerptLoading && (
                      <blockquote className="whitespace-pre-wrap rounded-xl border-l-2 border-sky-600 bg-stone-50 px-4 py-3 text-sm leading-relaxed text-stone-700">
                        {excerpt}
                      </blockquote>
                    )}
                    <Link
                      href={`/projects/${projectId}/materials`}
                      className="inline-block text-xs font-medium text-sky-700 hover:text-sky-800"
                    >
                      Open materials →
                    </Link>
                  </div>
                );
              })()}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
