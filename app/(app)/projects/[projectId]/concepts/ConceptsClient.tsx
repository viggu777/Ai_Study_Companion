"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConceptWithMeta } from "@/services/concept.service";
import { Badge, EmptyState } from "@/components/ui";
import { BookIcon, CardsIcon, ChatIcon, ConceptsIcon, QuizIcon } from "@/components/icons";

interface SubConcept {
  name: string;
  summary: string;
}

type SortKey = "NAME" | "WEAKEST" | "STRONGEST" | "TESTED";

/**
 * Module-level sub-concept cache — survives client-side navigation, so
 * re-expanding a concept after visiting another page is instant (no refetch).
 * (Concepts themselves are server-rendered via page.tsx; the client only
 * revalidates silently in the background.)
 */
const subConceptCache = new Map<string, SubConcept[]>();

function masteryTone(score: number | null): string {
  if (score === null) return "bg-stone-300";
  if (score < 35) return "bg-red-500";
  if (score < 70) return "bg-amber-500";
  return "bg-green-600";
}

function masteryLabel(score: number | null): { label: string; tone: "neutral" | "warning" | "accent" | "success" } {
  if (score === null) return { label: "Untested", tone: "neutral" };
  if (score < 35) return { label: "Weak", tone: "warning" };
  if (score < 70) return { label: "Developing", tone: "accent" };
  return { label: "Strong", tone: "success" };
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 shrink-0 text-stone-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * Concepts index — server-rendered (page.tsx passes initialConcepts), so the
 * page paints instantly with zero skeleton flash, including back-navigation.
 * The client revalidates silently and caches sub-concepts across visits.
 */
export default function ConceptsClient({
  projectId,
  initialConcepts,
}: {
  projectId: string;
  initialConcepts: ConceptWithMeta[];
}) {
  const [concepts, setConcepts] = useState<ConceptWithMeta[]>(initialConcepts);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [materialFilter, setMaterialFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("NAME");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [subs, setSubs] = useState<Record<string, SubConcept[]>>(() => {
    // Seed from the cross-navigation cache so re-expands are instant.
    const seed: Record<string, SubConcept[]> = {};
    for (const [k, v] of subConceptCache) seed[k] = v;
    return seed;
  });
  const [subsLoading, setSubsLoading] = useState<Record<string, boolean>>({});
  const [subsError, setSubsError] = useState<Record<string, string>>({});

  // Silent background revalidate — never shows a skeleton; the SSR data stays
  // visible the whole time. Keeps the index fresh after processing finishes
  // elsewhere without the old remount-flash.
  const refresh = useCallback(
    async () => {
      setRefreshing(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/concepts`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to refresh concepts");
        setConcepts((data.concepts ?? []) as ConceptWithMeta[]);
        setRefreshError(null);
      } catch (e) {
        // Non-blocking: keep showing SSR data, surface a subtle retry hint.
        setRefreshError(e instanceof Error ? e.message : String(e));
      } finally {
        setRefreshing(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const materials = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of concepts) {
      const key = c.materialName ?? "Other / no source";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [concepts]);

  const stats = useMemo(() => {
    const tested = concepts.filter((c) => c.currentScore !== null);
    const avg =
      tested.length > 0
        ? tested.reduce((s, c) => s + (c.currentScore ?? 0), 0) / tested.length
        : null;
    return {
      total: concepts.length,
      sources: materials.length,
      untested: concepts.length - tested.length,
      avg,
    };
  }, [concepts, materials]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = concepts.filter((c) => {
      if (materialFilter !== "all") {
        const key = c.materialName ?? "Other / no source";
        if (key !== materialFilter) return false;
      }
      if (
        q &&
        !(
          c.conceptName.toLowerCase().includes(q) ||
          (c.description ?? "").toLowerCase().includes(q) ||
          (c.materialName ?? "").toLowerCase().includes(q)
        )
      )
        return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "WEAKEST") return (a.currentScore ?? -1) - (b.currentScore ?? -1);
      if (sort === "STRONGEST") return (b.currentScore ?? -1) - (a.currentScore ?? -1);
      if (sort === "TESTED") return b.questionCount - a.questionCount || a.conceptName.localeCompare(b.conceptName);
      return a.conceptName.localeCompare(b.conceptName);
    });
    return list;
  }, [concepts, search, materialFilter, sort]);

  const grouped = useMemo(() => {
    const map = new Map<string, ConceptWithMeta[]>();
    for (const c of filtered) {
      const key = c.materialName ?? "Other / no source";
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  const toggle = async (c: ConceptWithMeta) => {
    if (expandedId === c.conceptId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(c.conceptId);
    const cached = subConceptCache.get(c.conceptId) ?? subs[c.conceptId];
    if (cached || subsLoading[c.conceptId]) return;
    setSubsLoading((p) => ({ ...p, [c.conceptId]: true }));
    setSubsError((p) => {
      const n = { ...p };
      delete n[c.conceptId];
      return n;
    });
    try {
      const res = await fetch(`/api/projects/${projectId}/concepts/${c.conceptId}/subconcepts`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load sub-concepts");
      const list = (data.subconcepts ?? []) as SubConcept[];
      subConceptCache.set(c.conceptId, list);
      setSubs((p) => ({ ...p, [c.conceptId]: list }));
    } catch (e) {
      setSubsError((p) => ({ ...p, [c.conceptId]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSubsLoading((p) => ({ ...p, [c.conceptId]: false }));
    }
  };

  if (concepts.length === 0 && !refreshing) {
    return (
      <EmptyState
        icon={<ConceptsIcon className="h-5 w-5" />}
        title="No concepts yet"
        description="Upload a PDF and wait for processing — concepts appear here automatically."
        action={
          <Link
            href={`/projects/${projectId}/materials`}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700"
          >
            <BookIcon className="h-4 w-4" />
            Go to materials
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Concepts", value: `${stats.total}` },
          { label: "Sources", value: `${stats.sources}` },
          { label: "Untested", value: `${stats.untested}` },
          { label: "Avg mastery", value: stats.avg !== null ? `${Math.round(stats.avg)}%` : "—" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-stone-200 bg-white p-3 text-center shadow-card">
            <p className="tnum text-lg font-semibold text-stone-900">{s.value}</p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-stone-400">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search concepts, descriptions, sources…"
              aria-label="Search concepts"
              className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort concepts"
            className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm"
          >
            <option value="NAME">Name A–Z</option>
            <option value="WEAKEST">Weakest first</option>
            <option value="STRONGEST">Strongest first</option>
            <option value="TESTED">Most practiced</option>
          </select>
          <button
            onClick={() => refresh()}
            disabled={refreshing}
            className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-50"
          >
            {refreshing ? "Updating…" : "Refresh"}
          </button>
          <span className="tnum text-xs text-stone-400" aria-live="polite">
            {filtered.length} of {concepts.length}
          </span>
        </div>
        {materials.length > 1 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Filter by source">
            {["all", ...materials.map(([name]) => name)].map((name) => {
              const active = materialFilter === name;
              const count = name === "all" ? concepts.length : (materials.find(([n]) => n === name)?.[1] ?? 0);
              return (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMaterialFilter(name)}
                  title={name === "all" ? "All sources" : name}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    active ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                  }`}
                >
                  <BookIcon className="h-3.5 w-3.5" />
                  <span className="max-w-40 truncate">{name === "all" ? "All sources" : name}</span>
                  <span className={`tnum ${active ? "text-stone-300" : "text-stone-400"}`}>{count}</span>
                </button>
              );
            })}
          </div>
        )}
        {refreshError && (
          <p className="mt-2 text-xs text-amber-700">
            Showing saved data — refresh failed ({refreshError}).{" "}
            <button onClick={() => refresh()} className="font-medium underline">
              Retry
            </button>
          </p>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
          No concepts match your search.
        </p>
      ) : (
        grouped.map(([material, items]) => (
          <section key={material}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-600/10 text-sky-700">
                <BookIcon className="h-4 w-4" />
              </span>
              <h2 className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500" title={material}>
                {material}
              </h2>
              <span className="tnum rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-500">
                {items.length}
              </span>
            </div>
            <ul className="space-y-2">
              {items.map((c) => {
                const open = expandedId === c.conceptId;
                const status = masteryLabel(c.currentScore);
                const subList = subs[c.conceptId] ?? [];
                return (
                  <li
                    key={c.conceptId}
                    className={`overflow-hidden rounded-2xl border bg-white transition-all ${
                      open ? "border-sky-600/40 shadow-card-hover" : "border-stone-200 shadow-card hover:border-stone-300"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(c)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-stone-50/60"
                    >
                      <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${masteryTone(c.currentScore)}`} title={status.label} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-stone-900" title={c.conceptName}>
                          {c.conceptName}
                        </span>
                        {c.description && !open && (
                          <span className="mt-0.5 block truncate text-[13px] text-stone-500" title={c.description}>
                            {c.description}
                          </span>
                        )}
                      </span>
                      <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {c.trend === "IMPROVING" && <Badge tone="success">↗ improving</Badge>}
                        {c.trend === "REQUIRES_ATTENTION" && <Badge tone="danger">needs attention</Badge>}
                        {c.questionCount > 0 && (
                          <span className="tnum text-[11px] text-stone-400">
                            {c.questionCount}q
                          </span>
                        )}
                      </span>
                      <span className="tnum shrink-0 text-sm font-semibold text-stone-700">
                        {c.currentScore !== null ? `${Math.round(c.currentScore)}%` : "—"}
                      </span>
                      <Chevron open={open} />
                    </button>
                    {open && (
                      <div className="border-t border-stone-100 bg-gradient-to-b from-sky-50/50 to-transparent px-4 py-4 sm:px-5">
                        {c.description && (
                          <p className="max-w-3xl text-sm leading-relaxed text-stone-700">{c.description}</p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <Badge tone={status.tone}>{status.label}</Badge>
                          {c.trend === "IMPROVING" && <Badge tone="success">↗ improving</Badge>}
                          {c.trend === "REQUIRES_ATTENTION" && <Badge tone="danger">needs attention</Badge>}
                          <span className="text-xs text-stone-400">
                            {c.currentScore !== null ? (
                              <>Score {Math.round(c.currentScore)}%</>
                            ) : (
                              <>Not yet tested</>
                            )}
                            {c.historyCount > 0 && <> · {c.historyCount} test{c.historyCount === 1 ? "" : "s"}</>}
                            {c.questionCount > 0 && <> · {c.questionCount} quiz question{c.questionCount === 1 ? "" : "s"}</>}
                          </span>
                        </div>

                        <div className="mt-4">
                          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">
                            Breakdown
                          </p>
                          {subsLoading[c.conceptId] && (
                            <div className="space-y-2" aria-label="Loading sub-concepts">
                              <div className="skeleton h-12 w-full rounded-xl" />
                              <div className="skeleton h-12 w-11/12 rounded-xl" />
                            </div>
                          )}
                          {subsError[c.conceptId] && (
                            <p className="text-xs text-red-600">
                              {subsError[c.conceptId]}{" "}
                              <button onClick={() => toggle(c)} className="font-medium underline">
                                Retry
                              </button>
                            </p>
                          )}
                          {!subsLoading[c.conceptId] && !subsError[c.conceptId] && subList.length > 0 && (
                            <ol className="relative space-y-3 border-l-2 border-sky-600/20 pl-5">
                              {subList.map((s, i) => (
                                <li key={i} className="relative">
                                  <span
                                    aria-hidden
                                    className="tnum absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full bg-sky-600 text-[9px] font-bold text-white"
                                  >
                                    {i + 1}
                                  </span>
                                  <p className="text-[13px] font-semibold text-stone-800">{s.name}</p>
                                  <p className="mt-0.5 text-[13px] leading-relaxed text-stone-600">{s.summary}</p>
                                </li>
                              ))}
                            </ol>
                          )}
                          {!subsLoading[c.conceptId] && !subsError[c.conceptId] && subList.length === 0 && (
                            <p className="text-xs text-stone-400">No breakdown available for this concept yet.</p>
                          )}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2 border-t border-stone-100 pt-3.5">
                          <Link
                            href={`/projects/${projectId}/quiz`}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-700"
                          >
                            <QuizIcon className="h-3.5 w-3.5" />
                            Practice
                          </Link>
                          <Link
                            href={`/projects/${projectId}/tutor?q=${encodeURIComponent(`Explain ${c.conceptName}`)}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50"
                          >
                            <ChatIcon className="h-3.5 w-3.5" />
                            Ask tutor
                          </Link>
                          <Link
                            href={`/projects/${projectId}/flashcards`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50"
                          >
                            <CardsIcon className="h-3.5 w-3.5" />
                            Flashcards
                          </Link>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
