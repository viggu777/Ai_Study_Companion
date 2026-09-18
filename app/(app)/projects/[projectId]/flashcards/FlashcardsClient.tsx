"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { ArrowRightIcon, CardsIcon } from "@/components/icons";
import {
  FLASHCARD_LEVEL_LABEL,
  FLASHCARD_LEVELS,
  clampFlashcardLevel,
  type FlashcardLevel,
} from "@/ai/flashcards";

interface Card {
  concept_id: string;
  concept_name: string;
  front: string;
  back: string;
  difficulty?: "easy" | "medium" | "hard";
}

interface Material {
  id: string;
  filename: string;
  status: string;
}

interface Concept {
  conceptId: string;
  conceptName: string;
  description: string | null;
  sourceMaterialId: string | null;
  materialName: string | null;
  currentScore: number | null;
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
  return FLASHCARD_COUNT_OPTIONS.reduce((best, opt) =>
    Math.abs(opt - n) < Math.abs(best - n) ? opt : best
  );
}

function difficultyTone(d?: string): string {
  if (d === "easy") return "bg-green-100 text-green-800";
  if (d === "hard") return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
}

export default function FlashcardsClient({
  projectId,
  initialCount,
  initialLevel,
  autostart,
}: {
  projectId: string;
  /** deep-link from Tutor: pre-select the deck size */
  initialCount?: number;
  /** deep-link from Tutor: pre-select the deck level */
  initialLevel?: FlashcardLevel;
  /** deep-link from Tutor: build the deck automatically on load */
  autostart?: boolean;
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const [deckLevel, setDeckLevel] = useState<FlashcardLevel>("MIXED");
  const [deckSource, setDeckSource] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keyed by concept_id (stable across shuffle) — the old index-based Set
  // silently marked the wrong cards after shuffling.
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [hideKnown, setHideKnown] = useState(false);
  const [count, setCount] = useState(
    initialCount !== undefined ? clampFlashcardCount(initialCount) : FLASHCARD_DEFAULT_COUNT
  );
  const [level, setLevel] = useState<FlashcardLevel>(
    initialLevel !== undefined ? clampFlashcardLevel(initialLevel) : "MIXED"
  );

  // ---- source selection: material filter + explicit concept picks ----
  // Best of both: a material dropdown scopes the list, and concept checkboxes
  // (grouped by material) pick exact cards. Explicit picks win over adaptive.
  const [materials, setMaterials] = useState<Material[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [materialFilter, setMaterialFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const autoStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mRes, cRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/materials`),
          fetch(`/api/projects/${projectId}/concepts`),
        ]);
        if (!cancelled) {
          if (mRes.ok) {
            const mData = await mRes.json();
            setMaterials(Array.isArray(mData) ? (mData as Material[]) : []);
          }
          if (cRes.ok) {
            const cData = await cRes.json();
            setConcepts(((cData.concepts ?? []) as Concept[]));
          }
        }
      } catch {
        // Selection stays in adaptive fallback mode.
      } finally {
        if (!cancelled) setLoadingSources(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const materialNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const mat of materials) m.set(mat.id, mat.filename);
    return m;
  }, [materials]);

  const filteredConcepts = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = concepts;
    if (materialFilter !== "all") {
      list = list.filter((c) => c.sourceMaterialId === materialFilter);
    }
    if (q) {
      list = list.filter(
        (c) =>
          c.conceptName.toLowerCase().includes(q) ||
          (c.description ?? "").toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => a.conceptName.localeCompare(b.conceptName));
  }, [concepts, materialFilter, search]);

  const groupedConcepts = useMemo(() => {
    const map = new Map<string, Concept[]>();
    for (const c of filteredConcepts) {
      const key = c.materialName ?? materialNameById.get(c.sourceMaterialId ?? "") ?? "Other / no source";
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [filteredConcepts, materialNameById]);

  const visibleIds = useMemo(() => new Set(filteredConcepts.map((c) => c.conceptId)), [filteredConcepts]);
  const selectedVisibleCount = useMemo(
    () => [...selectedIds].filter((id) => visibleIds.has(id)).length,
    [selectedIds, visibleIds]
  );

  const toggleConcept = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 20) next.add(id);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const c of filteredConcepts) {
        if (next.size >= 20) break;
        next.add(c.conceptId);
      }
      return next;
    });
  }, [filteredConcepts]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const generate = async () => {
    setError(null);
    setLoading(true);
    try {
      const explicit = [...selectedIds];
      const body: Record<string, unknown> =
        explicit.length > 0
          ? { conceptIds: explicit.slice(0, 20), level }
          : materialFilter !== "all"
            ? { count, materialId: materialFilter, level }
            : { count, level };
      const res = await fetch(`/api/projects/${projectId}/flashcards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate flashcards");
      setCards((data.cards ?? []) as Card[]);
      setDeckLevel(clampFlashcardLevel(data.level ?? level));
      setDeckSource(
        explicit.length > 0
          ? `${explicit.length} selected concept${explicit.length === 1 ? "" : "s"}`
          : materialFilter !== "all"
            ? (materialNameById.get(materialFilter) ?? "Selected material")
            : null
      );
      setIdx(0);
      setFlipped(false);
      setKnown(new Set());
      setHideKnown(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Deep-link autostart from the Tutor setup dialog (?count=N&level=L&start=1) —
  // fires once with the pre-selected options (StrictMode-safe via ref).
  useEffect(() => {
    if (autostart && !autoStartedRef.current) {
      autoStartedRef.current = true;
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- deck queue: hide-known filters the study queue, idx stays in-bounds ----
  const queue = useMemo(
    () => (hideKnown ? cards.filter((c) => !known.has(c.concept_id)) : cards),
    [cards, hideKnown, known]
  );
  useEffect(() => {
    if (idx >= queue.length && queue.length > 0) setIdx(queue.length - 1);
    if (queue.length === 0) setIdx(0);
  }, [queue.length, idx]);

  const card = queue[idx] ?? null;
  const total = queue.length;
  const fullTotal = cards.length;
  const cardKey = card ? card.concept_id : null;
  const cardKnown = cardKey ? known.has(cardKey) : false;

  const next = (markKnown: boolean | null) => {
    if (markKnown !== null && cardKey) {
      const key = cardKey;
      setKnown((prev) => {
        const nextSet = new Set(prev);
        if (markKnown) nextSet.add(key);
        else nextSet.delete(key);
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

  const restart = () => {
    setIdx(0);
    setFlipped(false);
  };

  const reviewUnknownOnly = () => {
    setHideKnown(true);
    setIdx(0);
    setFlipped(false);
  };

  // Keyboard study flow: Space/Enter flip, ←/→ move, 1 still-learning, 2 got-it.
  // Ignored while typing in inputs so search/answers keep working.
  useEffect(() => {
    if (!card || loading) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next(null);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "1") {
        next(false);
      } else if (e.key === "2") {
        next(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, idx, total, loading]);

  const selectionHint =
    selectedIds.size > 0
      ? `${selectedIds.size} concept${selectedIds.size === 1 ? "" : "s"} selected — deck builds exactly those.`
      : materialFilter !== "all"
        ? `Weakest ${count} from ${materialNameById.get(materialFilter) ?? "selected material"} at ${FLASHCARD_LEVEL_LABEL[level].toLowerCase()}.`
        : `Weakest ${count} across all materials at ${FLASHCARD_LEVEL_LABEL[level].toLowerCase()}.`;

  return (
    <div className="fade-enter w-full space-y-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-card sm:p-8">
        <div className="flex items-start gap-4">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-600 text-white">
            <CardsIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-stone-900">Flashcards</h2>
            <p className="mt-1 text-sm leading-relaxed text-stone-500">
              Pick concepts (grouped by material) or a single material — otherwise the deck auto-builds from your
              weakest concepts. Set a level, then flip with tap, space, or arrow keys.
            </p>

            {/* Material scope */}
            <div className="mt-4">
              <label htmlFor="flash-material" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">
                Source material
              </label>
              <select
                id="flash-material"
                value={materialFilter}
                onChange={(e) => {
                  setMaterialFilter(e.target.value);
                  setSelectedIds(new Set());
                }}
                disabled={loadingSources}
                className="w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm sm:max-w-xs"
                aria-label="Source material"
              >
                <option value="all">All materials (weakest first)</option>
                {materials.map((m) => {
                  const n = concepts.filter((c) => c.sourceMaterialId === m.id).length;
                  return (
                    <option key={m.id} value={m.id}>
                      {m.filename}{n > 0 ? ` · ${n}` : ""}{m.status !== "READY" ? ` (${m.status})` : ""}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Concept picker */}
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="flash-search" className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">
                  Concepts {selectedIds.size > 0 && <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-800">{selectedIds.size} picked</span>}
                </label>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={selectAllVisible} disabled={filteredConcepts.length === 0} className="font-medium text-sky-700 hover:text-sky-800 disabled:opacity-40">
                    Select visible
                  </button>
                  {selectedIds.size > 0 && (
                    <button type="button" onClick={clearSelection} className="font-medium text-stone-500 hover:text-stone-800">
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <input
                id="flash-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search concepts… (max 20 per deck)"
                aria-label="Search concepts"
                className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
              />
              <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-stone-200 bg-stone-50/60 p-2">
                {loadingSources ? (
                  <div className="space-y-2 p-2" aria-busy="true" aria-label="Loading concepts">
                    <div className="skeleton h-8 w-full rounded-lg" />
                    <div className="skeleton h-8 w-full rounded-lg" />
                    <div className="skeleton h-8 w-2/3 rounded-lg" />
                  </div>
                ) : filteredConcepts.length === 0 ? (
                  <p className="p-3 text-center text-xs text-stone-500">
                    {concepts.length === 0
                      ? "No concepts yet — upload a PDF and wait for processing."
                      : "No concepts match. Try a different material or search."}
                  </p>
                ) : (
                  groupedConcepts.map(([group, items]) => (
                    <div key={group} className="mb-2 last:mb-0">
                      <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">
                        {group} · {items.length}
                      </p>
                      <ul className="space-y-1">
                        {items.map((c) => {
                          const checked = selectedIds.has(c.conceptId);
                          return (
                            <li key={c.conceptId}>
                              <label
                                className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                                  checked ? "border-sky-600/50 bg-sky-50/70" : "border-transparent bg-white hover:border-stone-300"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleConcept(c.conceptId)}
                                  disabled={!checked && selectedIds.size >= 20}
                                  className="h-4 w-4 shrink-0 accent-sky-600"
                                  aria-label={c.conceptName}
                                />
                                <span className="min-w-0 flex-1 truncate font-medium text-stone-800" title={c.conceptName}>
                                  {c.conceptName}
                                </span>
                                {typeof c.currentScore === "number" && (
                                  <span className="tnum shrink-0 text-[11px] text-stone-400">{Math.round(c.currentScore)}%</span>
                                )}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))
                )}
              </div>
              {selectedVisibleCount > 0 && selectedVisibleCount < selectedIds.size && (
                <p className="mt-1 text-[11px] text-stone-400">
                  {selectedIds.size - selectedVisibleCount} picked concept{selectedIds.size - selectedVisibleCount === 1 ? "" : "s"} hidden by the current filter — still included.
                </p>
              )}
            </div>

            {/* Level + count */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-1.5 py-1" aria-label="Deck level">
                {FLASHCARD_LEVELS.map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    onClick={() => setLevel(lv)}
                    disabled={loading}
                    aria-pressed={level === lv}
                    title={lv === "MIXED" ? "Difficulty adapts per concept" : `All cards ${lv.toLowerCase()}`}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      level === lv ? "bg-sky-600 text-white" : "text-stone-500 hover:bg-stone-100"
                    }`}
                  >
                    {FLASHCARD_LEVEL_LABEL[lv]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-1.5 py-1" aria-label="Number of flashcards" title={selectedIds.size > 0 ? "Deck size follows your concept picks" : undefined}>
                {FLASHCARD_COUNT_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    disabled={loading || selectedIds.size > 0}
                    aria-pressed={count === n}
                    className={`tnum rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      count === n ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
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
            <p className="mt-2 text-xs text-stone-400" aria-live="polite">{selectionHint}</p>
            {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
          </div>
        </div>
      </div>

      {card && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="tnum text-sm text-stone-500">
              {idx + 1} / {total}
              {hideKnown && fullTotal > total && <span className="text-stone-400"> · {fullTotal - total} known hidden</span>}
            </span>
            <div className="flex items-center gap-3">
              {deckSource && <span className="max-w-56 truncate text-xs text-stone-400" title={deckSource}>{deckSource}</span>}
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600">
                {known.size} of {fullTotal} known
              </span>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-stone-500">
                <input type="checkbox" checked={hideKnown} onChange={(e) => { setHideKnown(e.target.checked); setIdx(0); setFlipped(false); }} className="h-3.5 w-3.5 accent-sky-600" />
                Hide known
              </label>
            </div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-valuenow={idx + 1} aria-valuemin={1} aria-valuemax={total} aria-label="Deck progress">
            <div className="h-full rounded-full bg-sky-600 transition-all" style={{ width: `${((idx + 1) / total) * 100}%` }} />
          </div>

          {/* 3D flip card */}
          <div style={{ perspective: "1200px" }}>
            <button
              type="button"
              onClick={() => setFlipped((f) => !f)}
              aria-live="polite"
              aria-label={flipped ? "Answer — activate to flip back" : "Prompt — activate to reveal answer"}
              className="block w-full text-center focus:outline-none"
            >
              <div
                className="relative w-full rounded-2xl border border-stone-200 bg-white shadow-card transition-transform duration-500 hover:shadow-card-hover"
                style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)", minHeight: "220px" }}
              >
                {/* front */}
                <div className="flex min-h-[220px] flex-col items-center justify-center p-8 sm:p-12" style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                    Prompt — tap or press space
                  </p>
                  <p className="mx-auto mt-3 max-w-xl text-xl font-medium leading-relaxed text-stone-900">
                    {card.front}
                  </p>
                  <p className="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-xs text-stone-400">
                    <span>{card.concept_name}</span>
                    {(card.difficulty ?? (deckLevel !== "MIXED" ? deckLevel.toLowerCase() : null)) && (
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${difficultyTone(card.difficulty ?? deckLevel.toLowerCase())}`}>
                        {card.difficulty ?? deckLevel.toLowerCase()}
                      </span>
                    )}
                    {cardKnown && <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-800">known</span>}
                  </p>
                </div>
                {/* back */}
                <div
                  className="absolute inset-0 flex min-h-[220px] flex-col items-center justify-center rounded-2xl bg-stone-900 p-8 text-center sm:p-12"
                  style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                    Answer — tap to flip back
                  </p>
                  <p className="mx-auto mt-3 max-w-xl text-lg font-medium leading-relaxed text-white">
                    {card.back}
                  </p>
                  <p className="mt-4 text-xs text-stone-400">{card.concept_name} · 1 still learning · 2 got it</p>
                </div>
              </div>
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              onClick={prev}
              disabled={idx === 0}
              className="rounded-lg px-4 py-2 text-sm font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Previous
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => setFlipped((f) => !f)}
                className="hidden rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 sm:block"
              >
                {flipped ? "Show prompt" : "Show answer"}
              </button>
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
            <div className="rounded-2xl border border-stone-200 bg-white p-5 text-center shadow-card">
              <p className="text-sm font-medium text-stone-900">
                {known.size >= fullTotal
                  ? "Deck complete — everything marked known. Nice work."
                  : `End of deck — ${known.size} of ${fullTotal} known.`}
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {known.size > 0 && known.size < fullTotal && !hideKnown && (
                  <Button variant="secondary" size="sm" onClick={reviewUnknownOnly}>
                    Review {fullTotal - known.size} still-learning only
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={restart}>
                  Restart deck
                </Button>
                <Button variant="secondary" size="sm" onClick={generate} disabled={loading}>
                  {loading ? "Building…" : "Regenerate (remaining gaps)"}
                </Button>
              </div>
            </div>
          )}
          <p className="text-center text-xs text-stone-400">
            Space flip · ←/→ move · 1 still learning · 2 got it
          </p>
        </div>
      )}

      {hideKnown && cards.length > 0 && queue.length === 0 && (
        <div className="rounded-2xl border border-green-600/20 bg-green-50/60 p-8 text-center">
          <p className="text-sm font-medium text-stone-900">All cards marked known</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
            Every card in this deck is known. Show them again or build a fresh deck.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => { setHideKnown(false); setIdx(0); }}>
              Show all {fullTotal}
            </Button>
            <Button size="sm" onClick={generate} disabled={loading}>
              {loading ? "Building…" : "New deck"}
            </Button>
          </div>
        </div>
      )}

      {!card && !(hideKnown && cards.length > 0) && !loading && !error && (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-stone-900">No deck yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
            Pick concepts above (or leave empty for weakest-first), choose a level, then generate — needs at least one processed PDF with concepts.
          </p>
        </div>
      )}
    </div>
  );
}
