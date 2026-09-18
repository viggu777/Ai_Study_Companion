"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, EmptyState } from "@/components/ui";
import { TargetIcon } from "@/components/icons";

export interface MasteryEntry {
  conceptId: string;
  conceptName: string;
  description: string | null;
  previousScore: number | null;
  currentScore: number | null;
  /** latest − prior (null when untested / single point without delta) */
  delta: number | null;
  trend: "IMPROVING" | "STABLE" | "REQUIRES_ATTENTION";
  historyCount: number;
  sourceMaterialId: string | null;
  materialName: string | null;
}

type TrendFilter = "ALL" | "IMPROVING" | "STABLE" | "REQUIRES_ATTENTION" | "UNTESTED";
type SortKey = "WEAKEST" | "STRONGEST" | "NAME" | "TESTED";

function trendTone(trend: MasteryEntry["trend"]): "success" | "neutral" | "danger" {
  if (trend === "IMPROVING") return "success";
  if (trend === "REQUIRES_ATTENTION") return "danger";
  return "neutral";
}

function statusOf(e: MasteryEntry): { label: string; tone: "neutral" | "success" | "accent" | "warning" } {
  if (e.currentScore === null) return { label: "Untested", tone: "neutral" };
  if (e.currentScore < 35) return { label: "Weak", tone: "warning" };
  if (e.currentScore < 70) return { label: "Developing", tone: "accent" };
  return { label: "Strong", tone: "success" };
}

/**
 * Mastery dashboard: summary stats + search/filter/sort + expandable concept
 * cards with trend, delta, history and next-step actions.
 */
export default function MasteryClient({
  entries,
  projectId,
  initialExpandedId,
}: {
  entries: MasteryEntry[];
  projectId: string;
  /** deep-link: pre-expand this concept's card (e.g. from the dashboard) */
  initialExpandedId?: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId ?? null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TrendFilter>("ALL");
  const [sort, setSort] = useState<SortKey>("WEAKEST");

  const stats = useMemo(() => {
    const tested = entries.filter((e) => e.currentScore !== null);
    const avg =
      tested.length > 0
        ? tested.reduce((s, e) => s + (e.currentScore ?? 0), 0) / tested.length
        : null;
    return {
      total: entries.length,
      tested: tested.length,
      untested: entries.length - tested.length,
      avg,
      improving: entries.filter((e) => e.trend === "IMPROVING").length,
      attention: entries.filter((e) => e.trend === "REQUIRES_ATTENTION").length,
    };
  }, [entries]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = entries.filter((e) => {
      if (filter === "UNTESTED" && e.currentScore !== null) return false;
      if ((filter === "IMPROVING" || filter === "STABLE" || filter === "REQUIRES_ATTENTION") && e.trend !== filter) return false;
      if (q && !(e.conceptName.toLowerCase().includes(q) || (e.description ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "NAME") return a.conceptName.localeCompare(b.conceptName);
      if (sort === "STRONGEST") return (b.currentScore ?? -1) - (a.currentScore ?? -1);
      if (sort === "TESTED") return b.historyCount - a.historyCount;
      return (a.currentScore ?? -1) - (b.currentScore ?? -1); // WEAKEST
    });
    return list;
  }, [entries, search, filter, sort]);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<TargetIcon className="h-5 w-5" />}
        title="No concepts yet"
        description="Upload a PDF and complete a quiz to see mastery."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "Average", value: stats.avg !== null ? `${Math.round(stats.avg)}%` : "—" },
          { label: "Tested", value: `${stats.tested}/${stats.total}` },
          { label: "Untested", value: `${stats.untested}` },
          { label: "Improving", value: `${stats.improving}` },
          { label: "Needs attention", value: `${stats.attention}` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-stone-200 bg-white p-3 text-center shadow-card">
            <p className="tnum text-lg font-semibold text-stone-900">{s.value}</p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-stone-400">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search concepts…"
          aria-label="Search concepts"
          className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as TrendFilter)}
          aria-label="Filter by trend"
          className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm"
        >
          <option value="ALL">All trends</option>
          <option value="IMPROVING">Improving</option>
          <option value="STABLE">Stable</option>
          <option value="REQUIRES_ATTENTION">Needs attention</option>
          <option value="UNTESTED">Untested</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort concepts"
          className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm"
        >
          <option value="WEAKEST">Weakest first</option>
          <option value="STRONGEST">Strongest first</option>
          <option value="NAME">Name A–Z</option>
          <option value="TESTED">Most tested</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
          No concepts match this filter.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((g) => {
            const expanded = expandedId === g.conceptId;
            const score = g.currentScore !== null ? Math.max(0, Math.min(100, g.currentScore)) : null;
            const status = statusOf(g);
            return (
              <article
                key={g.conceptId}
                className={`rounded-xl border bg-white p-4 shadow-card transition-colors ${
                  expanded ? "border-sky-600/40" : "border-stone-200"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : g.conceptId)}
                  aria-expanded={expanded}
                  className="block w-full text-left"
                >
                  <div className="flex items-start gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900" title={g.conceptName}>
                      {g.conceptName}
                    </h3>
                    <Badge tone={trendTone(g.trend)}>{g.trend}</Badge>
                  </div>
                  <div className="mt-2">
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-sky-600 transition-all"
                      role="progressbar"
                      aria-valuenow={score !== null ? Math.round(score) : 0}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Mastery ${status.label}`}
                      style={{ width: `${score ?? 0}%` }}
                    />
                  </div>
                </button>
                {expanded && (
                  <div className="mt-3 rounded-lg bg-stone-50 p-3">
                    {g.description && <p className="text-sm leading-relaxed text-stone-600">{g.description}</p>}
                    <dl className="mt-2 space-y-1 text-xs text-stone-500">
                      <div className="flex gap-1.5">
                        <dt className="font-medium text-stone-600">Previous:</dt>
                        <dd>{g.previousScore !== null ? g.previousScore.toFixed(1) : "Not yet tested"}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="font-medium text-stone-600">History:</dt>
                        <dd>
                          {g.historyCount} test{g.historyCount === 1 ? "" : "s"}
                          {g.materialName ? ` · from ${g.materialName}` : ""}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={`/projects/${projectId}/quiz`}
                        className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700"
                      >
                        Practice
                      </Link>
                      <Link
                        href={`/projects/${projectId}/tutor?q=${encodeURIComponent(`Explain ${g.conceptName}`)}`}
                        className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50"
                      >
                        Ask tutor
                      </Link>
                      <Link
                        href={`/projects/${projectId}/concepts`}
                        className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50"
                      >
                        Sub-concepts
                      </Link>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
