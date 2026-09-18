"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui";
import { TrendUpIcon } from "@/components/icons";
import type { GrowthEntry } from "@/services/growth.service";

type TrendFilter = "ALL" | "IMPROVING" | "STABLE" | "REQUIRES_ATTENTION" | "NEW";
type SortKey = "BIGGEST_GAIN" | "BIGGEST_DROP" | "WEAKEST" | "NAME";

function trendTone(trend: GrowthEntry["trend"]): "success" | "neutral" | "danger" {
  if (trend === "IMPROVING") return "success";
  if (trend === "REQUIRES_ATTENTION") return "danger";
  return "neutral";
}

function trendLabel(trend: GrowthEntry["trend"], isNew: boolean): string {
  if (isNew) return "New";
  if (trend === "IMPROVING") return "Improving";
  if (trend === "REQUIRES_ATTENTION") return "Needs attention";
  return "Stable";
}

function deltaTone(delta: number | null): string {
  if (delta === null) return "text-stone-400";
  if (delta > 0) return "text-green-700";
  if (delta < 0) return "text-red-700";
  return "text-stone-500";
}

export default function GrowthClient({
  entries,
  projectId,
}: {
  entries: GrowthEntry[];
  projectId: string;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TrendFilter>("ALL");
  const [sort, setSort] = useState<SortKey>("BIGGEST_DROP");

  const stats = useMemo(() => {
    const deltas = entries.map((e) => e.delta).filter((d): d is number => d !== null);
    const avgDelta =
      deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
    return {
      total: entries.length,
      improving: entries.filter((e) => e.trend === "IMPROVING" && e.delta !== null).length,
      stable: entries.filter((e) => e.trend === "STABLE").length,
      attention: entries.filter((e) => e.trend === "REQUIRES_ATTENTION").length,
      isNew: entries.filter((e) => e.delta === null).length,
      avgDelta,
    };
  }, [entries]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = entries.filter((e) => {
      const isNew = e.delta === null;
      if (filter === "NEW" && !isNew) return false;
      if (filter !== "ALL" && filter !== "NEW" && e.trend !== filter) return false;
      if (filter !== "NEW" && filter !== "ALL" && isNew && e.trend === "STABLE") {
        // New concepts show under Stable in data; hide them when filtering Stable
        // unless they have real history.
        if (e.historyCount === 0) return false;
      }
      if (
        q &&
        !(e.conceptName.toLowerCase().includes(q) || (e.description ?? "").toLowerCase().includes(q))
      )
        return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "NAME") return a.conceptName.localeCompare(b.conceptName);
      if (sort === "WEAKEST") return (a.currentScore ?? -1) - (b.currentScore ?? -1);
      if (sort === "BIGGEST_GAIN") return (b.delta ?? -Infinity) - (a.delta ?? -Infinity);
      return (a.delta ?? Infinity) - (b.delta ?? Infinity); // BIGGEST_DROP
    });
    return list;
  }, [entries, search, filter, sort]);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "Improving", value: `${stats.improving}` },
          { label: "Stable", value: `${stats.stable}` },
          { label: "Needs attention", value: `${stats.attention}` },
          { label: "New", value: `${stats.isNew}` },
          {
            label: "Avg change",
            value:
              stats.avgDelta !== null
                ? `${stats.avgDelta > 0 ? "+" : ""}${stats.avgDelta.toFixed(1)}`
                : "—",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-stone-200 bg-white p-3 text-center shadow-card"
          >
            <p className="tnum text-lg font-semibold text-stone-900">{s.value}</p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-stone-400">
              {s.label}
            </p>
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
          <option value="NEW">New</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort concepts"
          className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm"
        >
          <option value="BIGGEST_DROP">Biggest drop first</option>
          <option value="BIGGEST_GAIN">Biggest gain first</option>
          <option value="WEAKEST">Weakest first</option>
          <option value="NAME">Name A–Z</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
          No concepts match this filter.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((g) => {
            const isNew = g.delta === null;
            const score =
              g.currentScore !== null ? Math.max(0, Math.min(100, g.currentScore)) : null;
            return (
              <article
                key={g.conceptId}
                className="rounded-xl border border-stone-200 bg-white p-4 shadow-card"
              >
                <div className="flex items-start gap-2">
                  <h3
                    className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900"
                    title={g.conceptName}
                  >
                    {g.conceptName}
                  </h3>
                  <Badge tone={isNew ? "accent" : trendTone(g.trend)}>
                    {trendLabel(g.trend, isNew)}
                  </Badge>
                </div>

                <div className="mt-2 flex items-baseline gap-2">
                  <span className={`tnum text-xl font-semibold ${deltaTone(g.delta)}`}>
                    {g.delta !== null
                      ? `${g.delta > 0 ? "+" : ""}${g.delta.toFixed(1)}`
                      : "—"}
                  </span>
                  <span className="text-xs text-stone-400">
                    {isNew
                      ? "first result — take another quiz to see trend"
                      : `${g.previousScore !== null ? Math.round(g.previousScore) : "—"} → ${g.currentScore !== null ? Math.round(g.currentScore) : "—"}`}
                  </span>
                </div>

                {/* Current mastery bar */}
                <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-sky-600 transition-all"
                    role="progressbar"
                    aria-valuenow={score !== null ? Math.round(score) : 0}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Current mastery ${score !== null ? Math.round(score) : "untested"}`}
                    style={{ width: `${score ?? 0}%` }}
                  />
                </div>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-stone-500">
                  <TrendUpIcon className="h-3.5 w-3.5" />
                  {g.historyCount} result{g.historyCount === 1 ? "" : "s"}
                  {g.currentScore !== null
                    ? ` · now ${Math.round(g.currentScore)}/100`
                    : " · not yet scored"}
                </p>
                {g.description && (
                  <p className="mt-2 line-clamp-2 text-[13px] text-stone-500">{g.description}</p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/projects/${projectId}/quiz`}
                    className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700"
                  >
                    Practice
                  </Link>
                  <Link
                    href={`/projects/${projectId}/tutor?q=${encodeURIComponent(`Help me improve "${g.conceptName}" using my study material`)}`}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50"
                  >
                    Ask tutor
                  </Link>
                  <Link
                    href={`/projects/${projectId}/mastery?concept=${encodeURIComponent(g.conceptId)}`}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50"
                  >
                    Mastery
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
