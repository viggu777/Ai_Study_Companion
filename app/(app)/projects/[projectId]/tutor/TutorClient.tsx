"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, LinkButton, inputClass } from "@/components/ui";
import TutorMarkdown from "@/components/TutorMarkdown";
import { ArrowRightIcon, BookIcon, CardsIcon, ChatIcon, PlusIcon, QuizIcon, SparkIcon } from "@/components/icons";

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
  kind?: "quiz-card" | "flashcard-card";
}

interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  exchangeCount: number;
  created_at: string;
  updated_at: string;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
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

/** "flashcards / flip cards / revise with cards" → go to Flashcards page */
function isFlashcardIntent(text: string): boolean {
  return /\b(flashcard|flashcards|flip[\s-]?cards?|revise with cards|memorize)\b/i.test(text);
}

const SUGGESTIONS = [
  "Summarize my PDFs",
  "Give me a quiz",
  "What files do I have?",
  "What are the key concepts?",
];

/** Quick-action pills shown under every AI response header. */
const QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: "Quiz me", prompt: "Give me a quiz" },
  { label: "Practice", prompt: "Give me practice questions" },
  { label: "Flashcards", prompt: "Make flashcards from my materials" },
  { label: "Explain simply", prompt: "Explain this simply" },
  { label: "Explain deeply", prompt: "Explain this in depth" },
  { label: "Give example", prompt: "Give me a concrete example" },
  { label: "Summarize", prompt: "Summarize the key concepts" },
];

/** Fallback follow-ups so "You might also ask" always has 2–4 chips. */
const FALLBACK_FOLLOWUPS = [
  "Explain this simply",
  "Give me a concrete example",
  "Summarize the key points",
  "What should I review next?",
];

function buildFollowUps(parsed: TutorResponse): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string | null | undefined) => {
    const t = (s ?? "").trim();
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out.push(t);
  };
  push(parsed.followUpSuggestion);
  for (const f of FALLBACK_FOLLOWUPS) {
    if (out.length >= 4) break;
    push(f);
  }
  return out;
}

/* ---------- date helpers (Chats panel) ---------- */

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function groupLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const days = Math.round(
    (startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000
  );
  if (days <= 0) return "TODAY";
  if (days === 1) return "YESTERDAY";
  if (days <= 7) return "PREVIOUS 7 DAYS";
  if (days <= 30) return "PREVIOUS 30 DAYS";
  return d
    .toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    .toUpperCase();
}

/** "17 Sept" */
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

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

export default function TutorClient({
  projectId,
  initialQuestion,
}: {
  projectId: string;
  /** deep-link: pre-fill the composer (e.g. from the dashboard) — user reviews and sends */
  initialQuestion?: string | null;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [question, setQuestion] = useState(initialQuestion ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState("");
  const [chatsOpen, setChatsOpen] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [focusedCitations, setFocusedCitations] = useState<Citation[] | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [excerpts, setExcerpts] = useState<Record<string, string>>({});
  const [excerptsLoading, setExcerptsLoading] = useState(false);
  const excerptCache = useRef<Record<string, string>>({});
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Scroll ONLY the thread pane. (The old bottomRef.scrollIntoView() scrolled
  // every ancestor — including the outer <main> — shoving the chat upward.)
  const scrollBottom = (behavior: ScrollBehavior = "auto") => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };

  /* ---------- data loading ---------- */

  const fetchConversations = async (): Promise<ConversationSummary[]> => {
    const res = await fetch(`/api/projects/${projectId}/tutor/conversations`);
    if (!res.ok) throw new Error("Failed to list conversations");
    const data = await res.json();
    const list = (data.conversations ?? []) as ConversationSummary[];
    setConversations(list);
    return list;
  };

  const fetchHistory = async (conversationId: string) => {
    setFetching(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/tutor?conversationId=${encodeURIComponent(conversationId)}`
      );
      if (!res.ok) throw new Error("Failed to fetch history");
      const data = await res.json();
      setMessages((data.messages ?? []) as MessageRow[]);
    } catch (e) {
      console.error(e);
    } finally {
      setFetching(false);
    }
  };

  // Boot: load conversation list, ensure at least one conversation exists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFetching(true);
      try {
        const list = await fetchConversations();
        if (cancelled) return;
        if (list.length === 0) {
          const res = await fetch(`/api/projects/${projectId}/tutor/conversations`, {
            method: "POST",
          });
          if (res.ok) {
            const created = (await res.json()) as { id: string };
            const refreshed = await fetchConversations();
            if (cancelled) return;
            const id = created.id ?? refreshed[0]?.id ?? null;
            setActiveId(id);
            if (id) await fetchHistory(id);
            else setFetching(false);
          } else {
            setFetching(false);
          }
        } else {
          const id = list[0].id;
          setActiveId(id);
          await fetchHistory(id);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    // Glide when a new answer streams in; jump instantly for history loads.
    scrollBottom(messages.length > 0 && loading ? "smooth" : "auto");
  }, [messages, loading]);

  // Autogrow the composer (ChatGPT-style), capped at ~5 lines
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [question]);

  // Deep-linked question: focus the composer so the user can review and send.
  const initialQuestionRef = useRef(initialQuestion ?? null);
  useEffect(() => {
    if (initialQuestionRef.current) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- derived: sources for the panel ---------- */

  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant" || m.kind === "quiz-card" || m.kind === "flashcard-card") continue;
      const parsed = parseAssistant(m);
      if (parsed) return { message: m, parsed };
    }
    return null;
  }, [messages]);

  const panelCitations: Citation[] = focusedCitations ?? lastAssistant?.parsed.citations ?? [];
  const panelKey = useMemo(
    () => panelCitations.map((c) => c.chunkId).join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panelCitations.map((c) => c.chunkId).join(",")]
  );

  // Fetch excerpts for every citation shown in the Sources panel (cached per chunk).
  useEffect(() => {
    if (!sourcesOpen || panelCitations.length === 0) return;
    const missing = panelCitations.filter((c) => excerptCache.current[c.chunkId] === undefined);
    if (missing.length === 0) {
      setExcerpts({ ...excerptCache.current });
      return;
    }
    let cancelled = false;
    setExcerptsLoading(true);
    Promise.all(
      missing.map(async (c) => {
        try {
          const res = await fetch(`/api/chunks/${c.chunkId}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Failed to load excerpt");
          return [c.chunkId, (data.content ?? "") as string] as const;
        } catch {
          return [c.chunkId, "Excerpt unavailable for this source."] as const;
        }
      })
    ).then((pairs) => {
      if (cancelled) return;
      for (const [id, text] of pairs) excerptCache.current[id] = text;
      setExcerpts({ ...excerptCache.current });
      setExcerptsLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesOpen, panelKey]);

  const openSources = (citations: Citation[]) => {
    setFocusedCitations(citations);
    setSourcesOpen(true);
  };

  /* ---------- chat actions ---------- */

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

  const pushFlashcardCard = (q: string) => {
    const now = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: q, citations: null, created_at: now },
      {
        id: `flashcard-card-${Date.now()}`,
        role: "assistant",
        content: "",
        citations: [],
        created_at: now,
        kind: "flashcard-card",
      },
    ]);
  };

  const submitText = async (raw: string) => {
    const q = raw.trim();
    if (!q || loading) return;
    setError(null);

    // Quiz intent → navigate to the Quiz page instead of asking the tutor
    if (isQuizIntent(q)) {
      setQuestion("");
      pushQuizCard(q);
      return;
    }

    // Flashcard intent → navigate to the Flashcards page
    if (isFlashcardIntent(q)) {
      setQuestion("");
      pushFlashcardCard(q);
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
        body: JSON.stringify({ question: q, conversationId: activeId }),
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
      const now = new Date().toISOString();
      setMessages((prev) => [...prev.filter((m) => m.id !== tempId), { id: tempId.replace("temp-user", "user"), role: "user", content: q, citations: null, created_at: now }, assistantMsg]);
      if (data.conversationId && data.conversationId !== activeId) setActiveId(data.conversationId);
      // Refresh list (titles / counts) + canonical ids from server
      fetchConversations().catch(() => {});
      if (data.conversationId) {
        await fetchHistoryRefresh(data.conversationId as string);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Keep optimistic user message but remove temp
      setMessages((prev) => prev.filter((m) => m.id !== tempId).concat([{ id: `user-${Date.now()}`, role: "user", content: q, citations: null, created_at: new Date().toISOString() }]));
    } finally {
      setLoading(false);
    }
  };

  const fetchHistoryRefresh = async (conversationId: string) => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/tutor?conversationId=${encodeURIComponent(conversationId)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setMessages((data.messages ?? []) as MessageRow[]);
    } catch {
      // keep optimistic messages on refresh failure
    }
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    await submitText(question);
  };

  const switchConversation = async (id: string) => {
    if (id === activeId || loading) return;
    setActiveId(id);
    setError(null);
    setFocusedCitations(null);
    await fetchHistory(id);
  };

  const newChat = async () => {
    if (loading) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/tutor/conversations`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to create conversation");
      const created = (await res.json()) as { id: string };
      const list = await fetchConversations();
      setActiveId(created.id);
      setMessages([]);
      setError(null);
      setFocusedCitations(null);
      setSourcesOpen(false);
      if (list.length > 0 && !list.some((c) => c.id === created.id)) {
        await fetchConversations().catch(() => {});
      }
      inputRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const regenerate = async () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) await submitText(lastUser.content);
  };

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
    if (isFlashcardIntent(s)) {
      pushFlashcardCard(s);
      return;
    }
    setQuestion(s);
    inputRef.current?.focus();
  };

  /* ---------- chats panel grouping + search ---------- */

  const now = useMemo(() => new Date(), []);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, search]);

  const grouped = useMemo(() => {
    const groups: Array<{ label: string; items: ConversationSummary[] }> = [];
    const index = new Map<string, number>();
    for (const c of filtered) {
      const label = groupLabel(c.updated_at, now);
      const i = index.get(label);
      if (i === undefined) {
        index.set(label, groups.length);
        groups.push({ label, items: [c] });
      } else {
        groups[i].items.push(c);
      }
    }
    return groups;
  }, [filtered, now]);

  /* ---------- render ---------- */

  const renderMessage = (m: MessageRow) => {
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

    // Local flashcard-navigation card
    if (m.kind === "flashcard-card") {
      return (
        <div key={m.id} className="flex gap-3">
          <AssistantAvatar />
          <div className="min-w-0 flex-1 rounded-2xl border border-stone-200 bg-stone-50 p-5">
            <div className="flex items-center gap-2">
              <CardsIcon className="h-5 w-5 text-stone-700" />
              <p className="text-[15px] font-semibold text-stone-900">Ready to revise with flashcards?</p>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
              I&apos;ll build a flip-card deck from your weakest concepts — flip, mark known, and shuffle.
            </p>
            <div className="mt-4">
              <LinkButton href={`/projects/${projectId}/flashcards`}>
                Open flashcards
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
          <div className="min-w-0 flex-1">
            <TutorMarkdown content={m.content} />
          </div>
        </div>
      );
    }
    const isInsufficient = !parsed.grounded && parsed.citations.length === 0;
    const followUps = buildFollowUps(parsed);
    return (
      <div key={m.id} className="group flex gap-3">
        <AssistantAvatar />
        <div className="min-w-0 flex-1">
          {/* AI response header */}
          <div className="mb-1.5 flex items-center gap-1.5">
            <BookIcon className="h-3.5 w-3.5 text-sky-700" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              AI Tutor
            </span>
          </div>
          {/* Quick-action pills — scroll horizontally, never wrap */}
          <div
            className="tutor-pills -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1.5"
            role="toolbar"
            aria-label="Quick actions"
          >
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => submitText(a.prompt)}
                disabled={loading}
                className="shrink-0 whitespace-nowrap rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-card transition-colors hover:border-sky-600/40 hover:bg-sky-50/60 disabled:opacity-50"
              >
                {a.label}
              </button>
            ))}
          </div>
          <div
            className={cx(
              "rounded-2xl px-5 py-4",
              isInsufficient ? "border border-amber-200 bg-amber-50" : "bg-white"
            )}
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
            <TutorMarkdown content={parsed.answer} />
            {/* Grounded-in-knowledge indicator */}
            <div className="mt-3">
              {parsed.grounded ? (
                <button
                  type="button"
                  onClick={() => openSources(parsed.citations)}
                  className="inline-flex max-w-full items-center gap-2 rounded-full bg-stone-100 px-3 py-1.5 text-xs text-stone-700 transition-colors hover:bg-stone-200"
                  title="Open sources"
                >
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-sky-600" />
                  <span className="truncate">
                    Grounded in your project knowledge · {parsed.citations.length} relevant source{parsed.citations.length === 1 ? "" : "s"}
                  </span>
                </button>
              ) : (
                <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-stone-100 px-3 py-1.5 text-xs text-stone-500">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  <span className="truncate">Not grounded in project knowledge · 0 relevant sources</span>
                </span>
              )}
            </div>
            {/* Follow-up question chips */}
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-stone-500">You might also ask:</p>
              <div className="space-y-1.5">
                {followUps.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => submitText(f)}
                    disabled={loading}
                    className="block w-full truncate rounded-lg bg-stone-100 px-3.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-200 disabled:opacity-50"
                    title={f}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Compact action row */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => copyAnswer(m.id, parsed.answer)}
              className="rounded-md px-2 py-1 text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
            >
              {copiedId === m.id ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={regenerate}
              disabled={loading}
              className="rounded-md px-2 py-1 text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50"
            >
              Regenerate
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.focus()}
              className="rounded-md px-2 py-1 text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
            >
              Ask follow-up
            </button>
            <span className="ml-auto text-[11px] text-stone-400" title={new Date(m.created_at).toLocaleString()}>
              {formatTime(m.created_at)}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fade-enter relative flex h-[calc(100dvh-4rem)] min-h-0 overflow-hidden">
      {/* ---------- Chats panel ---------- */}
      {chatsOpen ? (
        <aside
          aria-label="Conversations"
          className="absolute inset-y-0 left-0 z-20 flex w-[260px] shrink-0 flex-col border-r border-stone-200 bg-white shadow-xl lg:static lg:z-auto lg:shadow-none"
        >
          <div className="flex items-center gap-1 border-b border-stone-100 px-3 py-3">
            <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              Chats
            </h2>
            <button
              type="button"
              onClick={() => setChatsOpen(false)}
              aria-label="Collapse chats panel"
              title="Collapse chats panel"
              className="ml-auto rounded-md px-2 py-1 text-sm leading-none text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
            >
              <span aria-hidden>‹</span>
            </button>
          </div>
          <div className="space-y-2.5 px-3 py-3">
            <Button variant="primary" size="sm" className="w-full" onClick={newChat} disabled={loading}>
              <PlusIcon className="h-4 w-4" />
              New Chat
            </Button>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations."
              aria-label="Search conversations"
              className={inputClass}
            />
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {grouped.length === 0 && (
              <p className="px-1 py-4 text-center text-xs text-stone-400">
                {search ? "No conversations match your search." : "No conversations yet."}
              </p>
            )}
            {grouped.map((g) => (
              <div key={g.label} className="mb-3">
                <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
                  {g.label}
                </p>
                <ul className="space-y-1">
                  {g.items.map((c) => {
                    const active = c.id === activeId;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => switchConversation(c.id)}
                          aria-current={active ? "true" : undefined}
                          className={cx(
                            "block w-full rounded-lg px-2.5 py-2 text-left transition-colors",
                            active
                              ? "bg-sky-50 ring-1 ring-inset ring-sky-600/20"
                              : "hover:bg-stone-100"
                          )}
                          title={c.title}
                        >
                          <span className="block truncate text-[13px] font-medium text-stone-900">
                            {c.title}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-stone-400">
                            {formatDay(c.updated_at)} · {c.exchangeCount} exchange{c.exchangeCount === 1 ? "" : "s"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </aside>
      ) : (
        <div className="flex w-9 shrink-0 flex-col items-center border-r border-stone-200 bg-white py-3">
          <button
            type="button"
            onClick={() => setChatsOpen(true)}
            aria-label="Open chats panel"
            title="Open chats panel"
            className="rounded-md px-2 py-1 text-sm leading-none text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          >
            <span aria-hidden>›</span>
          </button>
          <span
            aria-hidden
            className="mt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400"
            style={{ writingMode: "vertical-rl" }}
          >
            Chats
          </span>
        </div>
      )}

      {/* ---------- Main chat thread ---------- */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="w-full space-y-6 px-4 py-6 sm:px-6">
            {fetching ? (
              <div className="w-full space-y-4" aria-busy="true" aria-label="Loading conversation">
                <div className="skeleton h-10 w-2/3" />
                <div className="skeleton ml-auto h-10 w-1/2" />
                <div className="skeleton h-16 w-3/4" />
              </div>
            ) : (
              <>
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

                {messages.map(renderMessage)}

                {loading && (
                  <div className="flex gap-3">
                    <AssistantAvatar />
                    <TypingDots />
                  </div>
                )}
              </>
            )}
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
                    submitText(question);
                  }
                }}
                placeholder="Ask a question about your study material..."
                className="max-h-[140px] flex-1 resize-none bg-transparent py-2 text-[15px] text-stone-900 placeholder:text-stone-400 focus:outline-none"
                disabled={loading}
                aria-label="Ask a question about your study material"
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
              Answers are generated only from your uploaded study material.
            </p>
          </form>
        </div>
      </div>

      {/* ---------- Sources panel ---------- */}
      {sourcesOpen ? (
        <aside
          aria-label="Sources"
          className="absolute inset-y-0 right-0 z-20 flex w-[300px] shrink-0 flex-col border-l border-stone-200 bg-white shadow-xl xl:static xl:z-auto xl:shadow-none"
        >
          <div className="flex items-center gap-2 border-b border-stone-200 px-4 py-3.5">
            <BookIcon className="h-4 w-4 shrink-0 text-sky-700" />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-stone-900">
                Sources · {panelCitations.length} relevant
              </h2>
              <p className="text-[11px] text-stone-400">Referenced in the last response</p>
            </div>
            <button
              type="button"
              onClick={() => setSourcesOpen(false)}
              aria-label="Close sources"
              title="Close sources"
              className="ml-auto shrink-0 rounded-md px-2 py-1 text-lg leading-none text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
            >
              ×
            </button>
          </div>
          <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3.5">
            {panelCitations.length === 0 && (
              <p className="py-6 text-center text-xs text-stone-400">
                No sources for the last response yet. Ask a question to see citations here.
              </p>
            )}
            {panelCitations.map((c, i) => {
              const text = excerpts[c.chunkId];
              return (
                <article
                  key={c.chunkId + i}
                  className="rounded-xl border border-stone-200 bg-white p-3 shadow-card"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                      <BookIcon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-stone-900" title={c.materialName}>
                        {c.materialName}
                      </p>
                      <p className="mt-0.5 text-[11px] text-stone-400">Page {c.page}</p>
                    </div>
                  </div>
                  <div className="mt-2">
                    {excerptsLoading && text === undefined ? (
                      <div className="space-y-1.5" aria-label="Loading excerpt">
                        <div className="skeleton h-3.5 w-full" />
                        <div className="skeleton h-3.5 w-11/12" />
                        <div className="skeleton h-3.5 w-3/4" />
                      </div>
                    ) : (
                      <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-stone-600">
                        {text ?? "Excerpt unavailable for this source."}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="border-t border-stone-100 px-4 py-3">
            <Link
              href={`/projects/${projectId}/materials`}
              className="text-xs font-medium text-sky-700 hover:text-sky-800"
            >
              Open materials →
            </Link>
          </div>
        </aside>
      ) : (
        <div className="flex w-10 shrink-0 items-stretch border-l border-stone-200 bg-white">
          <button
            type="button"
            onClick={() => {
              setFocusedCitations((prev) => prev ?? lastAssistant?.parsed.citations ?? []);
              setSourcesOpen(true);
            }}
            aria-label="Open sources"
            title="Open sources"
            className="flex w-full flex-col items-center gap-2 py-4 text-stone-500 transition-colors hover:bg-stone-50 hover:text-stone-800"
          >
            <span aria-hidden className="text-xs leading-none">‹</span>
            <span
              aria-hidden
              className="text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ writingMode: "vertical-rl" }}
            >
              Sources · {panelCitations.length}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
