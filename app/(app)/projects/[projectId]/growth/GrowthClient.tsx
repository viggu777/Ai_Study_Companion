"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui";
import { ChatIcon, PracticeIcon, QuizIcon, SparkIcon, TargetIcon, TrendUpIcon } from "@/components/icons";
import { masteryLevelFor } from "@/lib/mastery-level";
import type { GrowthEntry } from "@/services/growth.service";

type TrendFilter = "ALL" | "IMPROVING" | "STABLE" | "REQUIRES_ATTENTION" | "NEW";
type SortKey = "BIGGEST_GAIN" | "BIGGEST_DROP" | "WEAKEST" | "NAME";

const isNew = (e: GrowthEntry) => e.delta === null;

function trendTone(trend: GrowthEntry["trend"]): "success" | "neutral" | "danger" {
  if (trend === "IMPROVING") return "success";
  if (trend === "REQUIRES_ATTENTION") return "danger";
  return "neutral";
}

function trendLabel(trend: GrowthEntry["trend"], fresh: boolean): string {
  if (fresh) return "New";
  if (trend === "IMPROVING") return "Improving";
  if (trend === "REQUIRES_ATTENTION") return "Needs attention";
  return "Stable";
}

const LEVEL_BAR: Record<string, string> = {
  MASTERED: "bg-emerald-500",
  PROFICIENT: "bg-sky-500",
  DEVELOPING: "bg-amber-500",
  EMERGING: "bg-orange-500",
  UNTESTED: "bg-stone-300",
};

const LEVEL_PILL: Record<string, string> = {
  MASTERED: "bg-emerald-600 text-white",
  PROFICIENT: "bg-sky-600 text-white",
  DEVELOPING: "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-600/25",
  EMERGING: "bg-orange-100 text-orange-900 ring-1 ring-inset ring-orange-600/25",
  UNTESTED: "bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-300",
};

const LEVEL_LABEL: Record<string, string> = {
  MASTERED: "Mastered",
  PROFICIENT: "Proficient",
  DEVELOPING: "Developing",
  EMERGING: "Emerging",
  UNTESTED: "Not started",
};

function tutorHref(projectId: string, conceptName: string) {
  return `/projects/${projectId}/tutor?q=${encodeURIComponent(`Help me improve "${conceptName}" using my study material`)}`;
}

function InsightRow({
  entry,
  projectId,
  kind,
}: {
  entry: GrowthEntry;
  projectId: string;
  kind: "gain" | "risk";
}) {
  const fresh = isNew(entry);
  return (
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-stone-200 bg-white px-3.5 py-2.5">
      <span className="min-w-0 flex-1 basis-40 truncate text-sm font-medium text-stone-900" title={entry.conceptName}>
        {entry.conceptName}
      </span>
      {!fresh && entry.delta !== null && (
        <span
          className={`tnum rounded-full px-2 py-0.5 text-xs font-semibold ${kind === "gain" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
        >
          {entry.delta > 0 ? "+" : ""}
          {entry.delta.toFixed(1)}
        </span>
      )}
      <span className="tnum text-xs text-stone-400">
        {fresh
          ? "first result"
          : `${entry.previousScore !== null ? Math.round(entry.previousScore) : "—"} → ${entry.currentScore !== null ? Math.round(entry.currentScore) : "—"}`}
      </span>
      <span className="flex gap-2.5 text-xs font-medium">
        <Link href={`/projects/${projectId}/quiz`} className="text-sky-700 hover:text-sky-800">
          Quiz
        </Link>
        <Link href={tutorHref(projectId, entry.conceptName)} className="text-sky-700 hover:text-sky-800">
          Tutor
        </Link>
      </span>
    </li>
  );
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
    const avgDelta = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
    return {
      total: entries.length,
      improving: entries.filter((e) => e.trend === "IMPROVING" && !isNew(e)).length,
      stable: entries.filter((e) => e.trend === "STABLE" && !isNew(e)).length,
      // REQUIRES_ATTENTION implies 2+ results (single-result is STABLE+null),
      // but guard with !isNew anyway so the three trend buckets + New always reconcile.
      attention: entries.filter((e) => e.trend === "REQUIRES_ATTENTION" && !isNew(e)).length,
      fresh: entries.filter((e) => isNew(e)).length,
      avgDelta,
      hasTrendData: entries.some((e) => e.historyCount >= 2),
    };
  }, [entries]);

  // What improved → top gains (needs 2 results); what needs attention →
  // requires-attention first, then the weakest tested concepts.
  const { topGains, topRisks } = useMemo(() => {
    const withTrend = entries.filter((e) => !isNew(e));
    const gains = [...withTrend]
      .filter((e) => e.trend === "IMPROVING")
      .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
      .slice(0, 3);
    const risks = [...entries]
      .filter((e) => e.trend === "REQUIRES_ATTENTION" || (e.currentScore !== null && e.currentScore < 60))
      .sort((a, b) => {
        const au = a.trend === "REQUIRES_ATTENTION" ? 0 : 1;
        const bu = b.trend === "REQUIRES_ATTENTION" ? 0 : 1;
        if (au !== bu) return au - bu;
        return (a.currentScore ?? 0) - (b.currentScore ?? 0);
      })
      .slice(0, 3);
    return { topGains: gains, topRisks: risks };
  }, [entries]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = entries.filter((e) => {
      const fresh = isNew(e);
      if (filter === "NEW") return fresh;
      if (filter !== "ALL") {
        if (fresh) return false;
        if (e.trend !== filter) return false;
      }
      if (
        q &&
        !(e.conceptName.toLowerCase().includes(q) || (e.description ?? "").toLowerCase().includes(q))
      )
        return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === "NAME") return a.conceptName.localeCompare(b.conceptName);
      if (sort === "WEAKEST") return (a.currentScore ?? -1) - (b.currentScore ?? -1);
      if (sort === "BIGGEST_GAIN") return (b.delta ?? -Infinity) - (a.delta ?? -Infinity);
      return (a.delta ?? Infinity) - (b.delta ?? Infinity); // BIGGEST_DROP
    });
  }, [entries, search, filter, sort]);

  const distTotal = Math.max(1, stats.total);

  return (
    <div className="space-y-5">
      {/* ── Summary: how the project is moving ── */}
      <section aria-label="Growth summary">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Improving", value: `${stats.improving}`, icon: <TrendUpIcon className="h-4 w-4" />, tone: "text-emerald-700" },
            { label: "Stable", value: `${stats.stable}`, icon: null, tone: "text-stone-700" },
            { label: "Needs attention", value: `${stats.attention}`, icon: <TargetIcon className="h-4 w-4" />, tone: "text-red-700" },
            { label: "New", value: `${stats.fresh}`, icon: <SparkIcon className="h-4 w-4" />, tone: "text-sky-700" },
            {
              label: "Avg change",
              value: stats.avgDelta !== null ? `${stats.avgDelta > 0 ? "+" : ""}${stats.avgDelta.toFixed(1)}` : "—",
              icon: null,
              tone: "text-stone-900",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-stone-200 bg-white p-3 text-center shadow-card"
            >
              <p className={`tnum flex items-center justify-center gap-1.5 text-lg font-semibold ${s.tone}`}>
                {s.icon}
                {s.value}
              </p>
              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-stone-400">
                {s.label}
              </p>
            </div>
          ))}
        </div>
        <div
          className="mt-2.5 flex h-2.5 overflow-hidden rounded-full bg-stone-100"
          role="img"
          aria-label={`Growth mix: ${stats.improving} improving, ${stats.stable} stable, ${stats.attention} needing attention, ${stats.fresh} new`}
        >
          {stats.improving > 0 && (
            <div className="bg-emerald-500" style={{ width: `${(stats.improving / distTotal) * 100}%` }} title={`${stats.improving} improving`} />
          )}
          {stats.stable > 0 && (
            <div className="bg-sky-400" style={{ width: `${(stats.stable / distTotal) * 100}%` }} title={`${stats.stable} stable`} />
          )}
          {stats.attention > 0 && (
            <div className="bg-red-500" style={{ width: `${(stats.attention / distTotal) * 100}%` }} title={`${stats.attention} need attention`} />
          )}
          {stats.fresh > 0 && (
            <div className="bg-stone-300" style={{ width: `${(stats.fresh / distTotal) * 100}%` }} title={`${stats.fresh} new`} />
          )}
        </div>
      </section>

      {!stats.hasTrendData && (
        <Card className="border-sky-600/20 bg-sky-50/60 p-4">
          <p className="text-sm text-stone-700">
            <span className="font-semibold text-stone-900">Not enough data for trends yet.</span>{" "}
            A trend compares your last two results per concept — take another quiz or practice round and the
            improving / needs-attention signals will appear here. Nothing below is a trend until then.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/projects/${projectId}/quiz`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
            >
              <QuizIcon className="h-3.5 w-3.5" />
              Take a quiz
            </Link>
            <Link
              href={`/projects/${projectId}/practice`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
            >
              <PracticeIcon className="h-3.5 w-3.5" />
              Practice instead
            </Link>
          </div>
        </Card>
      )}

      {/* ── What improved → what needs attention → what next ── */}
      <section aria-label="Growth insights" className="grid gap-4 lg:grid-cols-2">
        <Card className="border-emerald-600/20 p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <TrendUpIcon className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-stone-900">What improved</h2>
              <p className="text-xs text-stone-500">Biggest gains between your last two results</p>
            </div>
          </div>
          {topGains.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {topGains.map((g) => (
                <InsightRow key={g.conceptId} entry={g} projectId={projectId} kind="gain" />
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-lg bg-stone-50 px-3.5 py-2.5 text-[13px] text-stone-500">
              {stats.hasTrendData
                ? "No concept moved up more than 5 points yet — keep going, steady counts too."
                : "Gains will appear here once concepts have two results to compare."}
            </p>
          )}
        </Card>

        <Card className="border-amber-600/25 bg-amber-50/40 p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
              <TargetIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-stone-900">What needs attention</h2>
              <p className="text-xs text-stone-500">Declines and weakest scores — start at the top</p>
            </div>
            {topRisks.length > 0 && (
              <Link
                href={`/projects/${projectId}/recommendations`}
                className="shrink-0 text-xs font-medium text-sky-700 hover:text-sky-800"
              >
                Get plan →
              </Link>
            )}
          </div>
          {topRisks.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {topRisks.map((g) => (
                <InsightRow key={g.conceptId} entry={g} projectId={projectId} kind="risk" />
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-lg bg-white/70 px-3.5 py-2.5 text-[13px] text-stone-500 ring-1 ring-inset ring-stone-200">
              Nothing needs attention right now — no declines and no score below 60. Keep momentum with a
              quiz on your weakest tested topic.
            </p>
          )}
        </Card>
      </section>

      {/* ── All concepts ── */}
      <section aria-label="All concepts">
        <div className="mb-2.5 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-stone-900">All concepts</h2>
          <span className="tnum text-xs text-stone-400">
            {visible.length} of {entries.length} shown · sorted by biggest drop
          </span>
        </div>
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
          {(search || filter !== "ALL") && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setFilter("ALL");
              }}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-50"
            >
              Clear
            </button>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
            No concepts match this filter.{" "}
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setFilter("ALL");
              }}
              className="font-medium text-sky-700 hover:underline"
            >
              Clear filters
            </button>
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((g) => {
              const fresh = isNew(g);
              const level = masteryLevelFor(g.currentScore);
              const score = g.currentScore !== null ? Math.max(0, Math.min(100, g.currentScore)) : null;
              return (
                <article
                  key={g.conceptId}
                  className="flex flex-col rounded-xl border border-stone-200 bg-white p-4 shadow-card"
                >
                  <div className="flex items-start gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900" title={g.conceptName}>
                      {g.conceptName}
                    </h3>
                    <Badge tone={fresh ? "accent" : trendTone(g.trend)}>{trendLabel(g.trend, fresh)}</Badge>
                  </div>
                  <p className="mt-1">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${LEVEL_PILL[level]}`}
                    >
                      {LEVEL_LABEL[level]}
                      {score !== null ? ` · ${Math.round(score)}` : ""}
                    </span>
                  </p>

                  <div className="mt-2 flex items-baseline gap-2">
                    <span
                      className={`tnum text-xl font-semibold ${fresh ? "text-stone-400" : g.delta !== null && g.delta > 0 ? "text-emerald-700" : g.delta !== null && g.delta < 0 ? "text-red-700" : "text-stone-500"}`}
                    >
                      {g.delta !== null ? `${g.delta > 0 ? "+" : ""}${g.delta.toFixed(1)}` : "—"}
                    </span>
                    <span className="text-xs text-stone-400">
                      {fresh
                        ? "first result — take another quiz to see trend"
                        : `${g.previousScore !== null ? Math.round(g.previousScore) : "—"} → ${g.currentScore !== null ? Math.round(g.currentScore) : "—"} across last 2 results`}
                    </span>
                  </div>

                  <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className={`h-full rounded-full transition-all ${LEVEL_BAR[level]}`}
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
                    {g.currentScore !== null ? ` · now ${Math.round(g.currentScore)}/100` : " · not yet scored"}
                  </p>
                  {g.description && (
                    <p className="mt-2 line-clamp-2 text-[13px] text-stone-500">{g.description}</p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3">
                    <Link
                      href={`/projects/${projectId}/quiz`}
                      className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700"
                    >
                      <QuizIcon className="h-3.5 w-3.5" />
                      Quiz
                    </Link>
                    <Link
                      href={`/projects/${projectId}/practice`}
                      className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50"
                    >
                      <PracticeIcon className="h-3.5 w-3.5" />
                      Practice
                    </Link>
                    <Link
                      href={tutorHref(projectId, g.conceptName)}
                      className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50"
                    >
                      <ChatIcon className="h-3.5 w-3.5" />
                      Tutor
                    </Link>
                    <Link
                      href={`/projects/${projectId}/mastery?concept=${encodeURIComponent(g.conceptId)}`}
                      className="rounded-lg px-2 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-900"
                    >
                      Details →
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <details className="rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-600">
        <summary className="cursor-pointer font-medium text-stone-800">How are trends calculated?</summary>
        <p className="mt-2 text-[13px] leading-relaxed">
          A trend compares your <strong>last two results</strong> per concept (quiz, practice, and flashcard
          evidence all count). Moving <strong>more than 5 points</strong> up reads as improving, more than 5
          down needs attention, anything smaller is stable. With only one result there is no trend yet — that
          concept shows as <strong>New</strong>.
        </p>
      </details>
    </div>
  );
}
