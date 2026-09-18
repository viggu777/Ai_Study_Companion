"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { ArrowRightIcon } from "@/components/icons";

interface Card {
  concept_id: string;
  concept_name: string;
  front: string;
  back: string;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const FLASHCARD_COUNT_OPTIONS = [5, 10, 15, 20];
const FLASHCARD_DEFAULT_COUNT = 10;

function clampFlashcardCount(n: number): number {
  if (!Number.isFinite(n)) return FLASHCARD_DEFAULT_COUNT;
  if (FLASHCARD_COUNT_OPTIONS.includes(Math.floor(n))) return Math.floor(n);
  // Snap arbitrary deep-link values to the nearest supported size.
  return FLASHCARD_COUNT_OPTIONS.reduce((best, opt) =>
    Math.abs(opt - n) < Math.abs(best - n) ? opt : best
  );
}

export default function FlashcardsClient({
  projectId,
  initialCount,
  autostart,
}: {
  projectId: string;
  /** deep-link from Tutor: pre-select the deck size */
  initialCount?: number;
  /** deep-link from Tutor: build the deck automatically on load */
  autostart?: boolean;
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const [count, setCount] = useState(
    initialCount !== undefined ? clampFlashcardCount(initialCount) : FLASHCARD_DEFAULT_COUNT
  );
  const autoStartedRef = useRef(false);

  const generate = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/flashcards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate flashcards");
      setCards((data.cards ?? []) as Card[]);
      setIdx(0);
      setFlipped(false);
      setKnown(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Deep-link autostart from the Tutor setup dialog (?count=N&start=1) —
  // fires once with the pre-selected deck size (StrictMode-safe via ref).
  useEffect(() => {
    if (autostart && !autoStartedRef.current) {
      autoStartedRef.current = true;
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const card = cards[idx] ?? null;
  const total = cards.length;

  const next = (markKnown: boolean | null) => {
    if (markKnown !== null) {
      setKnown((prev) => {
        const nextSet = new Set(prev);
        if (markKnown) nextSet.add(idx);
        else nextSet.delete(idx);
        return nextSet;
      });
    }
    setFlipped(false);
    if (idx < total - 1) setIdx(idx + 1);
  };

  const prev = () => {
    setFlipped(false);
    if (idx > 0) setIdx(idx - 1);
  };

  return (
    <div className="fade-enter w-full space-y-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-card sm:p-8">
        <h2 className="text-lg font-semibold tracking-tight text-stone-900">Flashcards</h2>
        <p className="mt-1 text-sm leading-relaxed text-stone-500">
          Auto-built from your weakest concepts. Flip, mark known, shuffle through the deck.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-stone-600">
            Cards
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
              aria-label="Number of flashcards"
            >
              {[5, 10, 15, 20].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={generate} disabled={loading}>
            {loading && <Spinner className="text-white" />}
            {loading ? "Building deck…" : cards.length > 0 ? "Regenerate deck" : "Generate deck"}
          </Button>
          {cards.length > 0 && (
            <button
              onClick={() => {
                setCards((c) => shuffle(c));
                setIdx(0);
                setFlipped(false);
              }}
              className="rounded-lg px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900"
            >
              Shuffle
            </button>
          )}
        </div>
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      </div>

      {card && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="tnum text-sm text-stone-500">
              {idx + 1} / {total}
            </span>
            <span className="text-sm text-stone-500">{known.size} marked known</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
            <div className="h-full rounded-full bg-sky-600 transition-all" style={{ width: `${((idx + 1) / total) * 100}%` }} />
          </div>

          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            aria-live="polite"
            className="block w-full rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-card transition-all hover:shadow-card-hover sm:p-12"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
              {flipped ? "Answer — tap to flip back" : "Prompt — tap to reveal"}
            </p>
            <p className="mx-auto mt-3 max-w-xl text-xl font-medium leading-relaxed text-stone-900">
              {flipped ? card.back : card.front}
            </p>
            <p className="mt-4 text-xs text-stone-400">
              {card.concept_name} · click card or press space to flip
            </p>
          </button>

          <div className="flex items-center justify-between">
            <button
              onClick={prev}
              disabled={idx === 0}
              className="rounded-lg px-4 py-2 text-sm font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Previous
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => next(false)}
                className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
              >
                Still learning
              </button>
              <Button onClick={() => next(true)}>
                Got it
                <ArrowRightIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {idx === total - 1 && (
            <p className="text-center text-xs text-stone-400">
              End of deck — {known.size} of {total} known. Regenerate to focus on remaining gaps.
            </p>
          )}
        </div>
      )}

      {!card && !loading && !error && (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-stone-900">No deck yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
            Generate a deck above — needs at least one processed PDF with concepts.
          </p>
        </div>
      )}
    </div>
  );
}
