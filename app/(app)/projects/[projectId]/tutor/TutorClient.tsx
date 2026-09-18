"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, inputClass } from "@/components/ui";
import TutorMarkdown from "@/components/TutorMarkdown";
import {
  ArrowRightIcon,
  BookIcon,
  CardsIcon,
  ChatIcon,
  PinIcon,
  PlusIcon,
  PracticeIcon,
  QuizIcon,
  SparkIcon,
  TrashIcon,
} from "@/components/icons";
import {
  QUIZ_DEFAULT_COUNT,
  QUIZ_MAX_COUNT,
  QUIZ_MIN_COUNT,
  clampQuizCount,
} from "@/ai/quiz";
import {
  PRACTICE_DEFAULT_COUNT,
  PRACTICE_LEVEL_LABEL,
  PRACTICE_MAX_COUNT,
  PRACTICE_MIN_COUNT,
  clampPracticeCount,
  type PracticeLevel,
} from "@/ai/practice";

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
  kind?: "quiz-card" | "flashcard-card" | "practice-card";
}

/** Destination of the start-setup dialog (pick options → OK → go to page). */
type StartKind = "quiz" | "practice" | "flashcards";

interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  exchangeCount: number;
  created_at: string;
  updated_at: string;
  isPinned?: boolean;
  pinnedAt?: string | null;
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

/**
 * "practice questions / start practice / take an assignment" → Practice page.
 * Checked BEFORE isQuizIntent (which also matches "practice questions").
 */
function isPracticeIntent(text: string): boolean {
  return /\b(practice(\s+(questions|assignment|paper|test))?|start practice|take practice|assignment)\b/i.test(text);
}

const SUGGESTIONS = [
  "Summarize my PDFs",
  "Give me a quiz",
  "What files do I have?",
  "What are the key concepts?",
];

/** Quick-action pills — shown only under the latest answer to save space. */
const QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: "Quiz me", prompt: "Give me a quiz" },
  { label: "Practice", prompt: "Give me practice questions" },
  { label: "Flashcards", prompt: "Make flashcards from my materials" },
  { label: "Explain simply", prompt: "Explain this simply" },
  { label: "Explain deeply", prompt: "Explain this in depth" },
  { label: "Give example", prompt: "Give me a concrete example" },
  { label: "Summarize", prompt: "Summarize the key concepts" },
];

/** Fallback follow-ups so related prompts always have 2–3 compact chips. */
const FALLBACK_FOLLOWUPS = [
  "Explain this simply",
  "Give me a concrete example",
  "Summarize the key points",
  "What should I review next?",
];

/** Compact: model suggestion + up to 2 fallbacks (3 total, not 4). */
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
    if (out.length >= 3) break;
    push(f);
  }
  return out;
}

/* ---------- sessionStorage cache (stale-while-revalidate) ---------- */
/* Survives in-page navigation (same tab) so revisiting Tutor after visiting
   Quiz/Materials/etc. renders instantly instead of refetching everything. */

function cacheListKey(projectId: string) {
  return `tutor:${projectId}:conv-list`;
}
function cacheMsgsKey(projectId: string, conversationId: string) {
  return `tutor:${projectId}:msgs:${conversationId}`;
}
function cacheActiveKey(projectId: string) {
  return `tutor:${projectId}:active`;
}

function readCache<T>(key: string): T | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown) {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / private mode — cache is best-effort only
  }
}

function removeCache(key: string) {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
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

/** Delete-confirmation modal with explicit warning. */
function DeleteConfirmDialog({
  title,
  onCancel,
  onConfirm,
  deleting,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label="Delete conversation"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-semibold text-stone-900">Delete this chat?</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
          <span className="font-medium text-stone-800">“{title}”</span> and all its messages
          will be permanently removed. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- start-setup dialog (pick options → OK → go to page) ---------- */

const FLASHCARD_COUNT_OPTIONS = [5, 10, 15, 20];

function StartDialog({
  kind,
  quizCount,
  setQuizCount,
  practiceCount,
  setPracticeCount,
  practiceLevel,
  setPracticeLevel,
  flashCount,
  setFlashCount,
  onCancel,
  onConfirm,
}: {
  kind: StartKind;
  quizCount: number;
  setQuizCount: (n: number) => void;
  practiceCount: number;
  setPracticeCount: (n: number) => void;
  practiceLevel: PracticeLevel;
  setPracticeLevel: (l: PracticeLevel) => void;
  flashCount: number;
  setFlashCount: (n: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const meta =
    kind === "quiz"
      ? { title: "Start a quiz?", body: "Pick how many questions — they're chosen from your weakest concepts.", ok: "Start quiz" }
      : kind === "practice"
        ? { title: "Start practice?", body: "Pick how many questions and at which level.", ok: "Start practice" }
        : { title: "Build flashcards?", body: "Pick how many cards — built from your weakest concepts.", ok: "Build deck" };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={meta.title}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-semibold text-stone-900">{meta.title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-stone-600">{meta.body}</p>

        {kind === "quiz" && (
          <div className="mt-4 flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-1.5 py-1" aria-label="Number of questions">
            <button
              type="button"
              onClick={() => setQuizCount(clampQuizCount(quizCount - 1))}
              disabled={quizCount <= QUIZ_MIN_COUNT}
              aria-label="Fewer questions"
              className="flex h-7 w-7 items-center justify-center rounded-md text-base font-semibold text-stone-600 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <span className="tnum min-w-16 flex-1 text-center text-sm font-semibold text-stone-900" aria-live="polite">
              {quizCount} {quizCount === 1 ? "question" : "questions"}
            </span>
            <button
              type="button"
              onClick={() => setQuizCount(clampQuizCount(quizCount + 1))}
              disabled={quizCount >= QUIZ_MAX_COUNT}
              aria-label="More questions"
              className="flex h-7 w-7 items-center justify-center rounded-md text-base font-semibold text-stone-600 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
          </div>
        )}

        {kind === "practice" && (
          <div className="mt-4 space-y-2.5">
            <div className="flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-1.5 py-1" aria-label="Number of questions">
              <button
                type="button"
                onClick={() => setPracticeCount(clampPracticeCount(practiceCount - 1))}
                disabled={practiceCount <= PRACTICE_MIN_COUNT}
                aria-label="Fewer questions"
                className="flex h-7 w-7 items-center justify-center rounded-md text-base font-semibold text-stone-600 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                −
              </button>
              <span className="tnum min-w-16 flex-1 text-center text-sm font-semibold text-stone-900" aria-live="polite">
                {practiceCount} {practiceCount === 1 ? "question" : "questions"}
              </span>
              <button
                type="button"
                onClick={() => setPracticeCount(clampPracticeCount(practiceCount + 1))}
                disabled={practiceCount >= PRACTICE_MAX_COUNT}
                aria-label="More questions"
                className="flex h-7 w-7 items-center justify-center rounded-md text-base font-semibold text-stone-600 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                +
              </button>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-1.5 py-1" aria-label="Practice level">
              {(Object.keys(PRACTICE_LEVEL_LABEL) as PracticeLevel[]).map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setPracticeLevel(lv)}
                  aria-pressed={practiceLevel === lv}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                    practiceLevel === lv ? "bg-sky-600 text-white" : "text-stone-500 hover:bg-stone-100"
                  }`}
                >
                  {PRACTICE_LEVEL_LABEL[lv]}
                </button>
              ))}
            </div>
          </div>
        )}

        {kind === "flashcards" && (
          <div className="mt-4 flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-1.5 py-1" aria-label="Number of flashcards">
            {FLASHCARD_COUNT_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setFlashCount(n)}
                aria-pressed={flashCount === n}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                  flashCount === n ? "bg-sky-600 text-white" : "text-stone-500 hover:bg-stone-100"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm}>
            {meta.ok}
            <ArrowRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- memoized message row (avoids re-rendering the whole thread on each keystroke) ---------- */

const MessageItem = memo(function MessageItem({
  m,
  isLatestAssistant,
  loading,
  copiedId,
  onSubmitText,
  onOpenSources,
  onCopy,
  onRegenerate,
  onFocusComposer,
  onOpenStart,
}: {
  m: MessageRow;
  isLatestAssistant: boolean;
  loading: boolean;
  copiedId: string | null;
  onSubmitText: (text: string) => void;
  onOpenSources: (citations: Citation[]) => void;
  onCopy: (id: string, text: string) => void;
  onRegenerate: () => void;
  onFocusComposer: () => void;
  onOpenStart: (kind: StartKind) => void;
}) {
  // Quick-action pills: setup flows open the picker dialog, the rest send as chat.
  const handleQuickAction = (label: string, prompt: string) => {
    if (label === "Quiz me") onOpenStart("quiz");
    else if (label === "Practice") onOpenStart("practice");
    else if (label === "Flashcards") onOpenStart("flashcards");
    else onSubmitText(prompt);
  };
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-3xl bg-stone-100 px-5 py-2.5">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-stone-900">{m.content}</p>
        </div>
      </div>
    );
  }

  // Local quiz-navigation card
  if (m.kind === "quiz-card") {
    return (
      <div className="flex gap-3">
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
            <Button size="sm" onClick={() => onOpenStart("quiz")}>
              Start quiz
              <ArrowRightIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Local practice-navigation card
  if (m.kind === "practice-card") {
    return (
      <div className="flex gap-3">
        <AssistantAvatar />
        <div className="min-w-0 flex-1 rounded-2xl border border-stone-200 bg-stone-50 p-5">
          <div className="flex items-center gap-2">
            <PracticeIcon className="h-5 w-5 text-stone-700" />
            <p className="text-[15px] font-semibold text-stone-900">Ready for deep practice?</p>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
            I&apos;ll build an exam-style paper from your weak concepts — explain, reason, and apply.
          </p>
          <div className="mt-4">
            <Button size="sm" onClick={() => onOpenStart("practice")}>
              Open practice
              <ArrowRightIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Local flashcard-navigation card
  if (m.kind === "flashcard-card") {
    return (
      <div className="flex gap-3">
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
            <Button size="sm" onClick={() => onOpenStart("flashcards")}>
              Open flashcards
              <ArrowRightIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const parsed = parseAssistant(m);
  if (!parsed) {
    return (
      <div className="flex gap-3">
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
    <div className="group flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        {/* AI response header */}
        <div className="mb-1.5 flex items-center gap-1.5">
          <BookIcon className="h-3.5 w-3.5 text-sky-700" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
            AI Tutor
          </span>
        </div>
        {/* Quick-action pills — latest answer only, compact horizontal scroll */}
        {isLatestAssistant && (
          <div
            className="tutor-pills -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1.5"
            role="toolbar"
            aria-label="Quick actions"
          >
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => handleQuickAction(a.label, a.prompt)}
                disabled={loading}
                className="shrink-0 whitespace-nowrap rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 shadow-card transition-colors hover:border-sky-600/40 hover:bg-sky-50/60 hover:text-stone-800 disabled:opacity-50"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
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
          {/* Grounded indicator — short wording */}
          <div className="mt-2.5">
            {parsed.grounded ? (
              <button
                type="button"
                onClick={() => onOpenSources(parsed.citations)}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-800"
                title={`Grounded in your project knowledge · ${parsed.citations.length} relevant source${parsed.citations.length === 1 ? "" : "s"} — open sources`}
              >
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                <span className="truncate">
                  Grounded · {parsed.citations.length} source{parsed.citations.length === 1 ? "" : "s"}
                </span>
              </button>
            ) : (
              <span
                className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500"
                title="This answer is not grounded in your project knowledge"
              >
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="truncate">Not grounded</span>
              </span>
            )}
          </div>
          {/* Related follow-ups — compact inline chips so the answer stays dominant */}
          <div className="mt-2.5 border-t border-stone-100 pt-2.5">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">
              Related
            </p>
            <div className="flex flex-wrap gap-1.5">
              {followUps.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => onSubmitText(f)}
                  disabled={loading}
                  className="inline-flex max-w-[220px] items-center truncate rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-50"
                  title={f}
                >
                  <span className="truncate">{f}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* Compact action row */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => onCopy(m.id, parsed.answer)}
            className="rounded-md px-2 py-1 text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
          >
            {copiedId === m.id ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={loading}
            className="rounded-md px-2 py-1 text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50"
          >
            Regenerate
          </button>
          <button
            type="button"
            onClick={onFocusComposer}
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
});

export default function TutorClient({
  projectId,
  initialQuestion,
}: {
  projectId: string;
  /** deep-link: pre-fill the composer (e.g. from the dashboard) — user reviews and sends */
  initialQuestion?: string | null;
}) {
  const listKey = cacheListKey(projectId);
  const activeKey = cacheActiveKey(projectId);

  // Hydrate instantly from sessionStorage so back-navigation renders without a spinner.
  const [conversations, setConversations] = useState<ConversationSummary[]>(() => {
    const cached = readCache<ConversationSummary[]>(cacheListKey(projectId));
    return Array.isArray(cached) ? cached : [];
  });
  const [activeId, setActiveId] = useState<string | null>(() => {
    const cached = readCache<string>(cacheActiveKey(projectId));
    return typeof cached === "string" && cached ? cached : null;
  });
  const [messages, setMessages] = useState<MessageRow[]>(() => {
    const aid = readCache<string>(cacheActiveKey(projectId));
    if (typeof aid === "string" && aid) {
      const cached = readCache<MessageRow[]>(cacheMsgsKey(projectId, aid));
      if (Array.isArray(cached)) return cached;
    }
    return [];
  });
  const [question, setQuestion] = useState(initialQuestion ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(() => {
    // Cold boot → skeleton. Warm (cache hit) → render instantly, revalidate silently.
    const l = readCache<ConversationSummary[]>(cacheListKey(projectId));
    const a = readCache<string>(cacheActiveKey(projectId));
    const m = typeof a === "string" && a ? readCache<MessageRow[]>(cacheMsgsKey(projectId, a)) : null;
    return !(Array.isArray(l) && l.length > 0 && Array.isArray(m) && m.length >= 0 && a);
  });
  const [search, setSearch] = useState("");
  const [chatsOpen, setChatsOpen] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [focusedCitations, setFocusedCitations] = useState<Citation[] | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [excerpts, setExcerpts] = useState<Record<string, string>>({});
  const [excerptsLoading, setExcerptsLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pinBusyId, setPinBusyId] = useState<string | null>(null);
  const excerptCache = useRef<Record<string, string>>({});
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bootedRef = useRef(false);
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;
  const prefetchingRef = useRef<Set<string>>(new Set());
  // Live snapshot of the thread for cache writes inside async callbacks
  // (avoids adding `messages` to every useCallback dep array).
  const messagesSnapshot = useRef<MessageRow[]>(messages);
  messagesSnapshot.current = messages;
  const messagesRefSafe = useCallback(
    () => messagesSnapshot.current.filter((m) => !m.id.startsWith("temp-user")),
    []
  );
  const router = useRouter();

  /* ---------- start-setup dialog (pick options → OK → go to page) ---------- */
  const [startKind, setStartKind] = useState<StartKind | null>(null);
  const [startQuizCount, setStartQuizCount] = useState<number>(QUIZ_DEFAULT_COUNT);
  const [startPracticeCount, setStartPracticeCount] = useState<number>(PRACTICE_DEFAULT_COUNT);
  const [startPracticeLevel, setStartPracticeLevel] = useState<PracticeLevel>("MIXED");
  const [startFlashCount, setStartFlashCount] = useState<number>(10);

  const openStart = useCallback((kind: StartKind) => {
    setError(null);
    setStartKind(kind);
  }, []);

  const confirmStart = useCallback(() => {
    if (!startKind) return;
    const base =
      startKind === "quiz"
        ? `/projects/${projectId}/quiz?count=${clampQuizCount(startQuizCount)}&start=1`
        : startKind === "practice"
          ? `/projects/${projectId}/practice?count=${clampPracticeCount(startPracticeCount)}&level=${startPracticeLevel}&start=1`
          : `/projects/${projectId}/flashcards?count=${startFlashCount}&start=1`;
    setStartKind(null);
    router.push(base);
  }, [startKind, projectId, startQuizCount, startPracticeCount, startPracticeLevel, startFlashCount, router]);

  // Scroll ONLY the thread pane. (The old bottomRef.scrollIntoView() scrolled
  // every ancestor — including the outer <main> — shoving the chat upward.)
  const scrollBottom = (behavior: ScrollBehavior = "auto") => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };

  /* ---------- data loading (cached + abortable) ---------- */

  const fetchConversations = useCallback(
    async (signal?: AbortSignal): Promise<ConversationSummary[]> => {
      const res = await fetch(`/api/projects/${projectId}/tutor/conversations`, { signal });
      if (!res.ok) throw new Error("Failed to list conversations");
      const data = await res.json();
      const list = (data.conversations ?? []) as ConversationSummary[];
      setConversations(list);
      writeCache(listKey, list);
      return list;
    },
    [projectId, listKey]
  );

  const fetchHistory = useCallback(
    async (conversationId: string, signal?: AbortSignal, silent = false): Promise<MessageRow[]> => {
      if (!silent) setFetching(true);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/tutor?conversationId=${encodeURIComponent(conversationId)}`,
          { signal }
        );
        if (!res.ok) throw new Error("Failed to fetch history");
        const data = await res.json();
        const rows = (data.messages ?? []) as MessageRow[];
        setMessages(rows);
        writeCache(cacheMsgsKey(projectId, conversationId), rows);
        return rows;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return [];
        console.error(e);
        return [];
      } finally {
        if (!silent) setFetching(false);
      }
    },
    [projectId]
  );

  // Boot: cache-first, then revalidate. Sequential fetches only on a cold boot.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      // Warm boot — render cache instantly, revalidate quietly in the background.
      const cachedList = readCache<ConversationSummary[]>(cacheListKey(projectId));
      const cachedActive = readCache<string>(cacheActiveKey(projectId));
      if (Array.isArray(cachedList) && cachedList.length > 0 && typeof cachedActive === "string" && cachedActive) {
        setFetching(false);
        try {
          const list = await fetchConversations(ctrl.signal);
          if (cancelled) return;
          const stillActive = list.some((c) => c.id === cachedActive);
          const target = stillActive ? cachedActive : (list[0]?.id ?? null);
          if (target) {
            if (target !== activeIdRef.current) setActiveId(target);
            writeCache(cacheActiveKey(projectId), target);
            // Silent refresh so the thread never flashes a skeleton on revisit.
            await fetchHistory(target, ctrl.signal, true);
          } else {
            setFetching(false);
          }
        } catch {
          // Cache already on screen — background failure is non-fatal.
          if (!cancelled) setFetching(false);
        }
        return;
      }
      // Cold boot: load list, ensure at least one conversation exists.
      setFetching(true);
      try {
        const list = await fetchConversations(ctrl.signal);
        if (cancelled) return;
        if (list.length === 0) {
          const res = await fetch(`/api/projects/${projectId}/tutor/conversations`, {
            method: "POST",
            signal: ctrl.signal,
          });
          if (res.ok) {
            const created = (await res.json()) as { id: string };
            const refreshed = await fetchConversations(ctrl.signal);
            if (cancelled) return;
            const id = created.id ?? refreshed[0]?.id ?? null;
            setActiveId(id);
            if (id) {
              writeCache(cacheActiveKey(projectId), id);
              await fetchHistory(id, ctrl.signal, true);
            }
            setFetching(false);
          } else {
            setFetching(false);
          }
        } else {
          // Prefer the cached active conversation when it still exists.
          const cached = readCache<string>(cacheActiveKey(projectId));
          const id = typeof cached === "string" && list.some((c) => c.id === cached) ? cached : list[0].id;
          setActiveId(id);
          writeCache(cacheActiveKey(projectId), id);
          const cachedMsgs = readCache<MessageRow[]>(cacheMsgsKey(projectId, id));
          if (Array.isArray(cachedMsgs) && cachedMsgs.length > 0) {
            setMessages(cachedMsgs);
            setFetching(false);
            await fetchHistory(id, ctrl.signal, true);
          } else {
            await fetchHistory(id, ctrl.signal, true);
            setFetching(false);
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error(e);
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Persist active id + thread for instant revisit.
  useEffect(() => {
    if (activeId) writeCache(activeKey, activeId);
  }, [activeId, activeKey]);
  useEffect(() => {
    if (activeId && messages.length > 0) writeCache(cacheMsgsKey(projectId, activeId), messages);
  }, [messages, activeId, projectId]);

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

  const lastAssistantId = lastAssistant?.message.id ?? null;

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

  const openSources = useCallback((citations: Citation[]) => {
    setFocusedCitations(citations);
    setSourcesOpen(true);
  }, []);

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

  const pushPracticeCard = (q: string) => {
    const now = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: q, citations: null, created_at: now },
      {
        id: `practice-card-${Date.now()}`,
        role: "assistant",
        content: "",
        citations: [],
        created_at: now,
        kind: "practice-card",
      },
    ]);
  };

  const submitText = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q || loading) return;
      setError(null);

      // Practice intent first (isQuizIntent also matches "practice questions")
      if (isPracticeIntent(q)) {
        setQuestion("");
        pushPracticeCard(q);
        return;
      }

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

      const currentActive = activeIdRef.current;
      setLoading(true);
      // Optimistic user message
      const tempId = `temp-user-${Date.now()}`;
      setMessages((prev) => [...prev, { id: tempId, role: "user", content: q, citations: null, created_at: new Date().toISOString() }]);
      setQuestion("");

      try {
        const res = await fetch(`/api/projects/${projectId}/tutor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q, conversationId: currentActive }),
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
        const finalUserId = tempId.replace("temp-user", "user");
        const finalMessages: MessageRow[] = [
          { id: finalUserId, role: "user", content: q, citations: null, created_at: now },
          assistantMsg,
        ];
        setMessages((prev) => [...prev.filter((m) => m.id !== tempId), ...finalMessages]);
        const convId = data.conversationId as string | undefined;
        if (convId) {
          if (convId !== currentActive) {
            setActiveId(convId);
            writeCache(cacheActiveKey(projectId), convId);
          }
          // Persist the optimistic thread so a revisit never shows a half-written exchange.
          writeCache(
            cacheMsgsKey(projectId, convId),
            [...messagesRefSafe(), ...finalMessages].slice(-100)
          );
        }
        // Refresh the list in the background (titles / counts) — never block
        // the answer on it and never refetch history (optimistic thread is canonical).
        fetchConversations().catch(() => {});
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        // Keep optimistic user message but remove temp
        setMessages((prev) => prev.filter((m) => m.id !== tempId).concat([{ id: `user-${Date.now()}`, role: "user", content: q, citations: null, created_at: new Date().toISOString() }]));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, loading, fetchConversations, messagesRefSafe]
  );

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    await submitText(question);
  };

  const switchConversation = useCallback(
    async (id: string) => {
      const current = activeIdRef.current;
      if (id === current || loading) return;
      setActiveId(id);
      writeCache(cacheActiveKey(projectId), id);
      setError(null);
      setFocusedCitations(null);
      // Instant: show cached thread if we have it, revalidate quietly.
      const cached = readCache<MessageRow[]>(cacheMsgsKey(projectId, id));
      if (Array.isArray(cached) && cached.length > 0) {
        setMessages(cached);
        setFetching(false);
        fetchHistory(id, undefined, true).catch(() => {});
      } else {
        await fetchHistory(id);
      }
    },
    [loading, projectId, fetchHistory]
  );

  const prefetchHistory = useCallback(
    (id: string) => {
      if (id === activeIdRef.current || prefetchingRef.current.has(id)) return;
      if (readCache<MessageRow[]>(cacheMsgsKey(projectId, id))) return;
      prefetchingRef.current.add(id);
      fetch(`/api/projects/${projectId}/tutor?conversationId=${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && Array.isArray(data.messages)) {
            writeCache(cacheMsgsKey(projectId, id), (data.messages as MessageRow[]).slice(-100));
          }
        })
        .catch(() => {})
        .finally(() => {
          prefetchingRef.current.delete(id);
        });
    },
    [projectId]
  );

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
      writeCache(cacheActiveKey(projectId), created.id);
      setMessages([]);
      removeCache(cacheMsgsKey(projectId, created.id));
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

  const regenerate = useCallback(async () => {
    const lastUser = [...messagesSnapshot.current].reverse().find((m) => m.role === "user");
    if (lastUser) await submitText(lastUser.content);
  }, [submitText]);

  const copyAnswer = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((v) => (v === id ? null : v)), 1600);
    } catch {
      // clipboard unavailable — ignore
    }
  }, []);

  const focusComposer = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const applySuggestion = (s: string) => {
    if (isPracticeIntent(s)) {
      pushPracticeCard(s);
      return;
    }
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

  /* ---------- delete + pin ---------- */

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/tutor/conversations/${encodeURIComponent(target.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to delete conversation");
      }
      removeCache(cacheMsgsKey(projectId, target.id));
      const remaining = conversations.filter((c) => c.id !== target.id);
      setConversations(remaining);
      writeCache(listKey, remaining);
      setDeleteTarget(null);
      if (target.id === activeIdRef.current) {
        if (remaining.length > 0) {
          await switchConversation(remaining[0].id);
        } else {
          // Last chat deleted → start a fresh one so the thread never strands.
          setMessages([]);
          setActiveId(null);
          try {
            const res2 = await fetch(`/api/projects/${projectId}/tutor/conversations`, { method: "POST" });
            if (res2.ok) {
              const created = (await res2.json()) as { id: string };
              const list = await fetchConversations();
              setActiveId(created.id);
              writeCache(cacheActiveKey(projectId), created.id);
              setMessages([]);
              void list;
            }
          } catch {
            // leave empty state; user can hit New Chat
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const togglePin = async (c: ConversationSummary) => {
    if (pinBusyId) return;
    const next = !c.isPinned;
    setPinBusyId(c.id);
    // Optimistic reorder
    setConversations((prev) => {
      const updated = prev.map((x) =>
        x.id === c.id ? { ...x, isPinned: next, pinnedAt: next ? new Date().toISOString() : null } : x
      );
      const sorted = [...updated].sort((a, b) => {
        const pa = a.isPinned ? 1 : 0;
        const pb = b.isPinned ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });
      writeCache(listKey, sorted);
      return sorted;
    });
    try {
      const res = await fetch(
        `/api/projects/${projectId}/tutor/conversations/${encodeURIComponent(c.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: next }),
        }
      );
      if (!res.ok) throw new Error("Failed to update pin");
      // Background revalidate to pick up server timestamps.
      fetchConversations().catch(() => {});
    } catch (e) {
      // Roll back on failure
      setConversations((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, isPinned: c.isPinned, pinnedAt: c.pinnedAt ?? null } : x))
      );
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPinBusyId(null);
    }
  };

  /* ---------- chats panel grouping + search ---------- */

  const now = useMemo(() => new Date(), []);
  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const pa = a.isPinned ? 1 : 0;
      const pb = b.isPinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [conversations]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedConversations;
    return sortedConversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [sortedConversations, search]);

  const grouped = useMemo(() => {
    const groups: Array<{ label: string; items: ConversationSummary[] }> = [];
    const pinned = filtered.filter((c) => c.isPinned);
    const rest = filtered.filter((c) => !c.isPinned);
    if (pinned.length > 0) groups.push({ label: "PINNED", items: pinned });
    const index = new Map<string, number>();
    for (const c of rest) {
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
                    const pinned = !!c.isPinned;
                    return (
                      <li key={c.id} className="group relative">
                        <div
                          className={cx(
                            "flex items-center gap-1 rounded-lg pr-1 transition-colors",
                            active
                              ? "bg-sky-50 ring-1 ring-inset ring-sky-600/20"
                              : "hover:bg-stone-100"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => switchConversation(c.id)}
                            onMouseEnter={() => prefetchHistory(c.id)}
                            aria-current={active ? "true" : undefined}
                            className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left"
                            title={c.title}
                          >
                            <span className="flex items-center gap-1.5">
                              {pinned && (
                                <PinIcon className="h-3 w-3 shrink-0 text-sky-700" />
                              )}
                              <span className="block truncate text-[13px] font-medium text-stone-900">
                                {c.title}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[11px] text-stone-400">
                              {formatDay(c.updated_at)} · {c.exchangeCount} exchange{c.exchangeCount === 1 ? "" : "s"}
                            </span>
                          </button>
                          <span className="flex shrink-0 items-center">
                            <button
                              type="button"
                              onClick={() => togglePin(c)}
                              disabled={pinBusyId === c.id}
                              aria-label={pinned ? `Unpin ${c.title}` : `Pin ${c.title}`}
                              title={pinned ? "Unpin" : "Pin to top"}
                              className={cx(
                                "rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-200/70 hover:text-stone-700 disabled:opacity-50",
                                pinned
                                  ? "opacity-100 text-sky-700"
                                  : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
                              )}
                            >
                              <PinIcon className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(c)}
                              aria-label={`Delete ${c.title}`}
                              title="Delete chat"
                              className="rounded-md p-1.5 text-stone-400 opacity-0 transition-colors hover:bg-red-50 hover:text-red-700 focus-within:opacity-100 group-hover:opacity-100"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        </div>
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
            {fetching && messages.length === 0 ? (
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

                {messages.map((m) => (
                  <MessageItem
                    key={m.id}
                    m={m}
                    isLatestAssistant={m.id === lastAssistantId}
                    loading={loading}
                    copiedId={copiedId}
                    onSubmitText={submitText}
                    onOpenSources={openSources}
                    onCopy={copyAnswer}
                    onRegenerate={regenerate}
                    onFocusComposer={focusComposer}
                    onOpenStart={openStart}
                  />
                ))}

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

      {deleteTarget && (
        <DeleteConfirmDialog
          title={deleteTarget.title}
          deleting={deleting}
          onCancel={() => {
            if (!deleting) setDeleteTarget(null);
          }}
          onConfirm={confirmDelete}
        />
      )}

      {startKind && (
        <StartDialog
          kind={startKind}
          quizCount={startQuizCount}
          setQuizCount={setStartQuizCount}
          practiceCount={startPracticeCount}
          setPracticeCount={setStartPracticeCount}
          practiceLevel={startPracticeLevel}
          setPracticeLevel={setStartPracticeLevel}
          flashCount={startFlashCount}
          setFlashCount={setStartFlashCount}
          onCancel={() => setStartKind(null)}
          onConfirm={confirmStart}
        />
      )}
    </div>
  );
}
