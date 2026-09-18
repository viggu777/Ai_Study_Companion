"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface Concept {
  conceptId: string;
  conceptName: string;
  description: string | null;
  sourceMaterialId: string | null;
  materialName: string | null;
}

interface SubConcept {
  name: string;
  summary: string;
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
 * Concepts index — spaced accordion rows, deliberately distinct from Mastery
 * cards. No numbers, no scores, no trends: just a clean tappable row per
 * concept; tap to expand description + sub-concepts inline.
 */
export default function ConceptsClient({ projectId }: { projectId: string }) {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [subs, setSubs] = useState<Record<string, SubConcept[]>>({});
  const [subsLoading, setSubsLoading] = useState<Record<string, boolean>>({});
  const [subsError, setSubsError] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/concepts`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load concepts");
        setConcepts((data.concepts ?? []) as Concept[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...concepts].sort((a, b) => a.conceptName.localeCompare(b.conceptName));
    if (!q) return list;
    return list.filter(
      (c) =>
        c.conceptName.toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q) ||
        (c.materialName ?? "").toLowerCase().includes(q)
    );
  }, [concepts, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Concept[]>();
    for (const c of filtered) {
      const key = c.materialName ?? "Other / no source";
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  const toggle = async (c: Concept) => {
    if (expandedId === c.conceptId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(c.conceptId);
    if (subs[c.conceptId] || subsLoading[c.conceptId]) return;
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
      setSubs((p) => ({ ...p, [c.conceptId]: (data.subconcepts ?? []) as SubConcept[] }));
    } catch (e) {
      setSubsError((p) => ({ ...p, [c.conceptId]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSubsLoading((p) => ({ ...p, [c.conceptId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="space-y-2.5" aria-busy="true" aria-label="Loading concepts">
        <div className="skeleton h-10 w-full rounded-xl" />
        <div className="skeleton h-12 w-full rounded-xl" />
        <div className="skeleton h-12 w-full rounded-xl" />
        <div className="skeleton h-12 w-2/3 rounded-xl" />
      </div>
    );
  }

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;

  if (concepts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-stone-900">No concepts yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">Upload a PDF and wait for processing — concepts appear here automatically.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search concepts…"
          aria-label="Search concepts"
          className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
        />
        <span className="text-xs text-stone-400">
          {filtered.length} of {concepts.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
          No concepts match your search.
        </p>
      ) : (
        grouped.map(([material, items]) => (
          <section key={material}>
            <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
              {material} · {items.length}
            </h2>
            <ul className="space-y-2">
              {items.map((c) => {
                const open = expandedId === c.conceptId;
                return (
                  <li
                    key={c.conceptId}
                    className={`overflow-hidden rounded-xl border bg-white transition-colors ${
                      open ? "border-sky-600/40 shadow-card" : "border-stone-200 hover:border-stone-300"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(c)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-stone-50"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-900" title={c.conceptName}>
                        {c.conceptName}
                      </span>
                      <Chevron open={open} />
                    </button>
                    {open && (
                      <div className="border-t border-stone-100 px-4 py-3">
                        {c.description && (
                          <p className="text-[13px] leading-relaxed text-stone-600">{c.description}</p>
                        )}
                        <div className="mt-2.5">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">
                            Sub-concepts
                          </p>
                          {subsLoading[c.conceptId] && (
                            <div className="space-y-1.5" aria-label="Loading sub-concepts">
                              <div className="skeleton h-4 w-full rounded" />
                              <div className="skeleton h-4 w-11/12 rounded" />
                            </div>
                          )}
                          {subsError[c.conceptId] && (
                            <p className="text-xs text-red-600">{subsError[c.conceptId]}</p>
                          )}
                          {(subs[c.conceptId] ?? []).length > 0 && (
                            <ul className="space-y-2.5">
                              {(subs[c.conceptId] ?? []).map((s, i) => (
                                <li key={i} className="flex gap-2.5">
                                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-sky-600" />
                                  <span>
                                    <span className="block text-[13px] font-semibold text-stone-800">{s.name}</span>
                                    <span className="mt-0.5 block text-[13px] leading-relaxed text-stone-600">{s.summary}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-stone-100 pt-2.5 text-xs">
                          <Link href={`/projects/${projectId}/quiz`} className="font-medium text-sky-700 hover:text-sky-800">
                            Practice →
                          </Link>
                          <Link
                            href={`/projects/${projectId}/tutor?q=${encodeURIComponent(`Explain ${c.conceptName}`)}`}
                            className="font-medium text-stone-500 hover:text-stone-800"
                          >
                            Ask tutor →
                          </Link>
                          <Link href={`/projects/${projectId}/flashcards`} className="font-medium text-stone-500 hover:text-stone-800">
                            Flashcards →
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
