"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui";
import { TargetIcon, QuizIcon, PracticeIcon, CardsIcon, ChatIcon } from "@/components/icons";
import type {
  MasteryOverviewEntry,
  MasteryOverviewSummary,
  MasteryLevel,
} from "@/services/mastery.service";

export type { MasteryOverviewEntry };

type LevelFilter = "ALL" | MasteryLevel;
type TrendFilter = "ALL" | "IMPROVING" | "STABLE" | "REQUIRES_ATTENTION";
type SourceFilter = "ALL" | "QUIZ" | "PRACTICE" | "FLASHCARD" | "UNPRACTICED";
type SortKey = "NEEDS_ATTENTION" | "WEAKEST" | "STRONGEST" | "MOST_PRACTICED" | "RECENT" | "NAME";
type ViewMode = "LEVELS" | "MATERIALS";

const LEVEL_ORDER: MasteryLevel[] = ["MASTERED", "PROFICIENT", "DEVELOPING", "EMERGING", "UNTESTED"];

const LEVEL_STYLE: Record<
  MasteryLevel,
  { label: string; range: string; pill: string; dot: string; bar: string; softBg: string }
> = {
  MASTERED: {
    label: "Mastered",
    range: "90–100",
    pill: "bg-emerald-600 text-white",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    softBg: "bg-emerald-50",
  },
  PROFICIENT: {
    label: "Proficient",
    range: "70–89",
    pill: "bg-sky-600 text-white",
    dot: "bg-sky-500",
    bar: "bg-sky-500",
    softBg: "bg-sky-50",
  },
  DEVELOPING: {
    label: "Developing",
    range: "35–69",
    pill: "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-600/25",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
    softBg: "bg-amber-50",
  },
  EMERGING: {
    label: "Emerging",
    range: "0–34",
    pill: "bg-orange-100 text-orange-900 ring-1 ring-inset ring-orange-600/25",
    dot: "bg-orange-500",
    bar: "bg-orange-500",
    softBg: "bg-orange-50",
  },
  UNTESTED: {
    label: "Not started",
    range: "—",
    pill: "bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-300",
    dot: "bg-stone-300",
    bar: "bg-stone-300",
    softBg: "bg-stone-50",
  },
};

function trendMeta(trend: MasteryOverviewEntry["trend"]): { label: string; chip: string; arrow: string } {
  if (trend === "IMPROVING") return { label: "Improving", chip: "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/20", arrow: "↗" };
  if (trend === "REQUIRES_ATTENTION") return { label: "Needs attention", chip: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20", arrow: "↘" };
  return { label: "Stable", chip: "bg-stone-100 text-stone-600", arrow: "→" };
}

function sourceLabel(s: MasteryOverviewEntry["sources"]["lastSource"]): string {
  if (s === "quiz") return "Quiz";
  if (s === "practice") return "Practice";
  if (s === "flashcard") return "Flashcards";
  return "—";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "recently";
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function Sparkline({ values, className = "h-8 w-28" }: { values: number[]; className?: string }) {
  if (values.length < 2) {
    return <span className="text-[11px] text-stone-400">{values.length === 1 ? "1 result — keep going" : "No results yet"}</span>;
  }
  const w = 112;
  const h = 32;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 4) + 2;
    const y = h - 3 - ((v - min) / span) * (h - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = values[values.length - 1];
  const first = values[0];
  const up = last >= first;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} role="img" aria-label={`Score trend ${first} to ${last}`}>
      <polyline points={pts.join(" ")} fill="none" stroke={up ? "#059669" : "#dc2626"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]} r={3} fill={up ? "#059669" : "#dc2626"} />
    </svg>
  );
}

function MasteryRing({ value }: { value: number | null }) {
  const pct = value !== null ? Math.max(0, Math.min(100, value)) : 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  const color = value === null ? "#d6d3d1" : pct >= 90 ? "#059669" : pct >= 70 ? "#0284c7" : pct >= 35 ? "#f59e0b" : "#ea580c";
  return (
    <div className="relative h-24 w-24 shrink-0" role="progressbar" aria-valuenow={value !== null ? Math.round(value) : 0} aria-valuemin={0} aria-valuemax={100} aria-label={`Overall mastery ${value !== null ? Math.round(value) : "unmeasured"} percent`}>
      <svg viewBox="0 0 84 84" className="h-24 w-24 -rotate-90">
        <circle cx={42} cy={42} r={r} fill="none" stroke="#f5f5f4" strokeWidth={9} />
        <circle cx={42} cy={42} r={r} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum text-xl font-bold leading-none text-stone-900">{value !== null ? `${Math.round(value)}%` : "—"}</span>
        <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-400">mastery</span>
      </div>
    </div>
  );
}

function deltaChip(delta: number | null) {
  if (delta === null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span className={`tnum inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${up ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
      {up ? "▲" : "▼"} {up ? "+" : ""}{delta.toFixed(1)}
    </span>
  );
}

export default function MasteryClient({
  entries,
  summary,
  materials,
  projectId,
  initialExpandedId,
}: {
  entries: MasteryOverviewEntry[];
  summary: MasteryOverviewSummary;
  materials: Array<{ id: string; filename: string }>;
  projectId: string;
  initialExpandedId?: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId ?? null);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<LevelFilter>("ALL");
  const [material, setMaterial] = useState<string>("ALL");
  const [trend, setTrend] = useState<TrendFilter>("ALL");
  const [source, setSource] = useState<SourceFilter>("ALL");
  const [sort, setSort] = useState<SortKey>("NEEDS_ATTENTION");
  const [view, setView] = useState<ViewMode>("LEVELS");

  const weakest = useMemo(() => [...entries].sort((a, b) => (a.currentScore ?? -1) - (b.currentScore ?? -1))[0] ?? null, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = entries.filter((e) => {
      if (level !== "ALL" && e.level !== level) return false;
      if (material !== "ALL" && (e.sourceMaterialId ?? "__none__") !== material) return false;
      if (trend !== "ALL" && e.trend !== trend) return false;
      if (source === "QUIZ" && e.sources.quizCount === 0) return false;
      if (source === "PRACTICE" && e.sources.practiceCount === 0) return false;
      if (source === "FLASHCARD" && e.sources.flashcardCount === 0) return false;
      if (source === "UNPRACTICED" && e.historyCount > 0) return false;
      if (q && !(e.conceptName.toLowerCase().includes(q) || (e.description ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === "NAME") return a.conceptName.localeCompare(b.conceptName);
      if (sort === "STRONGEST") return (b.currentScore ?? -1) - (a.currentScore ?? -1);
      if (sort === "MOST_PRACTICED") return b.historyCount - a.historyCount || (a.currentScore ?? 0) - (b.currentScore ?? 0);
      if (sort === "RECENT") return (b.lastUpdatedAt ?? "").localeCompare(a.lastUpdatedAt ?? "");
      if (sort === "WEAKEST") return (a.currentScore ?? -1) - (b.currentScore ?? -1);
      // NEEDS_ATTENTION: requires-attention first, then lowest score
      const au = a.trend === "REQUIRES_ATTENTION" ? 0 : 1;
      const bu = b.trend === "REQUIRES_ATTENTION" ? 0 : 1;
      if (au !== bu) return au - bu;
      return (a.currentScore ?? -1) - (b.currentScore ?? -1);
    });
  }, [entries, search, level, material, trend, source, sort]);

  const grouped: Array<{ title: string; subtitle: string; items: MasteryOverviewEntry[]; key: string; level?: MasteryLevel }> = useMemo(() => {
    if (view === "MATERIALS") {
      const map = new Map<string, MasteryOverviewEntry[]>();
      for (const e of filtered) {
        const key = e.materialName ?? "Other / no source";
        const arr = map.get(key) ?? [];
        arr.push(e);
        map.set(key, arr);
      }
      return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([title, items]) => ({
        title,
        subtitle: `${items.length} concept${items.length === 1 ? "" : "s"}`,
        items,
        key: `mat:${title}`,
      }));
    }
    return LEVEL_ORDER.map((lv) => ({
      title: LEVEL_STYLE[lv].label,
      subtitle: `${LEVEL_STYLE[lv].range} · ${summary.distribution[lv]} total`,
      items: filtered.filter((e) => e.level === lv),
      key: `lvl:${lv}`,
      level: lv as MasteryLevel,
    })).filter((g) => g.items.length > 0);
  }, [filtered, view, summary.distribution]);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<TargetIcon className="h-5 w-5" />}
        title="No concepts yet"
        description="Upload a PDF and answer a quiz, practice, or flashcard question to see mastery build here."
        action={<Link href={`/projects/${projectId}/materials`} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">Upload material</Link>}
      />
    );
  }

  const distTotal = Math.max(1, summary.total);
  const coverage = summary.total > 0 ? Math.round((summary.tested / summary.total) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* ── Overview ─────────────────────────────────────────── */}
      <section aria-label="Mastery overview" className="rounded-2xl border border-stone-200 bg-white p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <div className="flex items-center gap-4">
            <MasteryRing value={summary.avg} />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-stone-900">Subject mastery</h2>
              <p className="mt-0.5 text-sm text-stone-500">
                {summary.tested}/{summary.total} concepts tested · {coverage}% coverage
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {weakest && weakest.currentScore !== null ? (
                  <Link href={`/projects/${projectId}/quiz`} className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-800">
                    Quiz weakest: {weakest.conceptName.slice(0, 22)}{weakest.conceptName.length > 22 ? "…" : ""}
                  </Link>
                ) : (
                  <Link href={`/projects/${projectId}/quiz`} className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-800">
                    Start first quiz
                  </Link>
                )}
                <Link href={`/projects/${projectId}/practice`} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50">
                  Practice
                </Link>
                <Link href={`/projects/${projectId}/flashcards`} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50">
                  Flashcards
                </Link>
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            {/* Level distribution */}
            <div>
              <div className="flex h-3 overflow-hidden rounded-full bg-stone-100" role="img" aria-label={`Distribution: ${summary.distribution.MASTERED} mastered, ${summary.distribution.PROFICIENT} proficient, ${summary.distribution.DEVELOPING} developing, ${summary.distribution.EMERGING} emerging, ${summary.distribution.UNTESTED} not started`}>
                {(Object.keys(LEVEL_STYLE) as MasteryLevel[]).map((lv) => {
                  const n = summary.distribution[lv];
                  if (n === 0) return null;
                  return <div key={lv} className={LEVEL_STYLE[lv].dot} style={{ width: `${(n / distTotal) * 100}%` }} title={`${LEVEL_STYLE[lv].label}: ${n}`} />;
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-600">
                {(Object.keys(LEVEL_STYLE) as MasteryLevel[]).map((lv) => (
                  <button key={lv} type="button" onClick={() => setLevel(level === lv ? "ALL" : lv)} className={`inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 hover:bg-stone-100 ${level === lv ? "font-semibold text-stone-900" : ""}`} title={`Filter: ${LEVEL_STYLE[lv].label}`}>
                    <span className={`h-2 w-2 rounded-full ${LEVEL_STYLE[lv].dot}`} aria-hidden />
                    {LEVEL_STYLE[lv].label} <span className="tnum font-semibold">{summary.distribution[lv]}</span>
                  </button>
                ))}
              </div>
            </div>
            {/* Source activity */}
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Quiz evidence", value: `${summary.quizEvents}`, sub: "graded · 30% weight", icon: <QuizIcon className="h-4 w-4" /> },
                { label: "Practice evidence", value: `${summary.practiceEvents}`, sub: "graded · 30% weight", icon: <PracticeIcon className="h-4 w-4" /> },
                { label: "Card reviews", value: `${summary.flashcardReviews}`, sub: summary.flashcardKnownRate !== null ? `${summary.flashcardKnownRate}% got-it · 15% weight` : "self-report · 15% weight", icon: <CardsIcon className="h-4 w-4" /> },
                { label: "Needs attention", value: `${summary.attention}`, sub: `${summary.improving} improving`, icon: <TargetIcon className="h-4 w-4" /> },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-stone-500"><span className="text-stone-400">{s.icon}</span>{s.label}</p>
                  <p className="tnum mt-0.5 text-lg font-semibold text-stone-900">{s.value}</p>
                  <p className="text-[11px] text-stone-400">{s.sub}</p>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <details className="mt-4 rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-600">
          <summary className="cursor-pointer font-medium text-stone-800">How is mastery calculated?</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
            <li><strong>Quiz</strong> (graded MCQ / open-ended): new = prev × 0.7 + evidence × 0.3. Strongest signal.</li>
            <li><strong>Practice</strong> (graded, incl. secondaries): same 0.7 / 0.3 formula. Primary uses your score; shown ideas count 80, partial 50, missing ≤30.</li>
            <li><strong>Flashcards</strong> (self-reported): new = prev × 0.85 + evidence × 0.15. “Got it” = 85, “Still learning” = 20 — gentle by design so recall nudges, never games.</li>
            <li><strong>Levels:</strong> Mastered 90–100 · Proficient 70–89 · Developing 35–69 · Emerging 0–34 · Not started (no evidence yet).</li>
            <li><strong>Trend:</strong> compares your last two results — +5 improving, −5 needs attention, else stable.</li>
          </ul>
        </details>
      </section>

      {/* ── Controls ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search concepts or descriptions…"
          aria-label="Search concepts"
          className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
        />
        <select value={level} onChange={(e) => setLevel(e.target.value as LevelFilter)} aria-label="Filter by level" className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm">
          <option value="ALL">All levels</option>
          <option value="MASTERED">Mastered</option>
          <option value="PROFICIENT">Proficient</option>
          <option value="DEVELOPING">Developing</option>
          <option value="EMERGING">Emerging</option>
          <option value="UNTESTED">Not started</option>
        </select>
        <select value={material} onChange={(e) => setMaterial(e.target.value)} aria-label="Filter by material" className="max-w-52 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm">
          <option value="ALL">All materials</option>
          {materials.map((m) => <option key={m.id} value={m.id}>{m.filename}</option>)}
          <option value="__none__">No source</option>
        </select>
        <select value={trend} onChange={(e) => setTrend(e.target.value as TrendFilter)} aria-label="Filter by trend" className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm">
          <option value="ALL">All trends</option>
          <option value="IMPROVING">Improving</option>
          <option value="STABLE">Stable</option>
          <option value="REQUIRES_ATTENTION">Needs attention</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} aria-label="Filter by evidence source" className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm">
          <option value="ALL">All evidence</option>
          <option value="QUIZ">Has quiz</option>
          <option value="PRACTICE">Has practice</option>
          <option value="FLASHCARD">Has flashcards</option>
          <option value="UNPRACTICED">Unpracticed</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort concepts" className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm">
          <option value="NEEDS_ATTENTION">Needs attention first</option>
          <option value="WEAKEST">Lowest score</option>
          <option value="STRONGEST">Highest score</option>
          <option value="MOST_PRACTICED">Most practiced</option>
          <option value="RECENT">Recently updated</option>
          <option value="NAME">Name A–Z</option>
        </select>
        <div className="flex rounded-xl border border-stone-300 bg-white p-1" role="group" aria-label="Group concepts by">
          {(["LEVELS", "MATERIALS"] as ViewMode[]).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${view === v ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100"}`}>
              {v === "LEVELS" ? "By level" : "By material"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
          No concepts match these filters. <button type="button" onClick={() => { setSearch(""); setLevel("ALL"); setMaterial("ALL"); setTrend("ALL"); setSource("ALL"); }} className="font-medium text-sky-700 hover:underline">Clear filters</button>
        </p>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.key} aria-label={group.title}>
              <div className="mb-2.5 flex items-center gap-2">
                {group.level ? <span className={`h-2.5 w-2.5 rounded-full ${LEVEL_STYLE[group.level].dot}`} aria-hidden /> : <span className="h-2.5 w-2.5 rounded-full bg-sky-500" aria-hidden />}
                <h3 className="text-sm font-semibold text-stone-900">{group.title}</h3>
                <span className="text-xs text-stone-400">{group.subtitle} · {group.items.length} shown</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((e) => {
                  const expanded = expandedId === e.conceptId;
                  const lv = LEVEL_STYLE[e.level];
                  const tm = trendMeta(e.trend);
                  const score = e.currentScore !== null ? Math.max(0, Math.min(100, e.currentScore)) : null;
                  return (
                    <article key={e.conceptId} className={`flex flex-col rounded-2xl border bg-white p-4 shadow-card transition-colors ${expanded ? "border-sky-600/50" : "border-stone-200"}`}>
                      <button type="button" onClick={() => setExpandedId(expanded ? null : e.conceptId)} aria-expanded={expanded} className="block w-full text-left">
                        <div className="flex items-start gap-2">
                          <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900" title={e.conceptName}>{e.conceptName}</h4>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${lv.pill}`}>{lv.label}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="tnum text-2xl font-bold tracking-tight text-stone-900">{score !== null ? Math.round(score) : "—"}</span>
                          <span className="text-xs text-stone-400">/100</span>
                          {deltaChip(e.delta)}
                          <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tm.chip}`}>
                            <span aria-hidden>{tm.arrow}</span> {e.trend === "REQUIRES_ATTENTION" ? "Attention" : tm.label}
                          </span>
                        </div>
                        {/* Progress with level thresholds */}
                        <div className="relative mt-2.5 h-2 overflow-hidden rounded-full bg-stone-100">
                          <div className={`h-full rounded-full transition-all ${lv.bar}`} role="progressbar" aria-valuenow={score !== null ? Math.round(score) : 0} aria-valuemin={0} aria-valuemax={100} aria-label={`${e.conceptName} mastery ${score !== null ? Math.round(score) : "not started"}`} style={{ width: `${score ?? 0}%` }} />
                        </div>
                        <div className="relative mt-1 flex justify-between text-[10px] text-stone-300" aria-hidden>
                          <span>0</span><span className="absolute left-[35%]">·35</span><span className="absolute left-[70%]">·70</span><span className="absolute left-[90%]">·90</span><span>100</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <Sparkline values={e.sparkline} />
                          <span className="text-right text-[11px] leading-tight text-stone-400">
                            {e.historyCount} event{e.historyCount === 1 ? "" : "s"}<br />last {timeAgo(e.lastUpdatedAt)} · {sourceLabel(e.sources.lastSource)}
                          </span>
                        </div>
                      </button>

                      {/* Evidence chips */}
                      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${e.sources.quizCount > 0 ? "bg-sky-50 text-sky-800" : "bg-stone-50 text-stone-400"}`} title="Quiz attempts (graded)">
                          <QuizIcon className="h-3 w-3" /> Quiz ×{e.sources.quizCount}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${e.sources.practiceCount > 0 ? "bg-violet-50 text-violet-800" : "bg-stone-50 text-stone-400"}`} title="Practice answers (graded)">
                          <PracticeIcon className="h-3 w-3" /> Practice ×{e.sources.practiceCount}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${e.sources.flashcardCount > 0 ? "bg-emerald-50 text-emerald-800" : "bg-stone-50 text-stone-400"}`} title={`Flashcard reviews: ${e.sources.flashcardKnown} got-it, ${e.sources.flashcardLearning} still-learning`}>
                          <CardsIcon className="h-3 w-3" /> Cards {e.sources.flashcardKnown}✓{e.sources.flashcardLearning > 0 ? `/${e.sources.flashcardLearning}•` : ""}
                          {e.sources.flashcardCount === 0 ? " ×0" : ""}
                        </span>
                      </div>
                      {e.materialName && <p className="mt-1.5 truncate text-[11px] text-stone-400" title={e.materialName}>📄 {e.materialName}</p>}

                      {expanded && (
                        <div className="mt-3 space-y-3 rounded-xl bg-stone-50 p-3">
                          {e.description && <p className="text-[13px] leading-relaxed text-stone-600">{e.description}</p>}
                          <div className="grid grid-cols-3 gap-1.5 text-center">
                            {[
                              { k: "Quiz", v: e.sources.quizCount, hint: "graded · 30%" },
                              { k: "Practice", v: e.sources.practiceCount, hint: "graded · 30%" },
                              { k: "Cards", v: e.sources.flashcardCount, hint: `${e.sources.flashcardKnown}✓ self-report · 15%` },
                            ].map((s) => (
                              <div key={s.k} className="rounded-lg border border-stone-200 bg-white px-2 py-1.5">
                                <p className="tnum text-sm font-bold text-stone-900">{s.v}</p>
                                <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">{s.k}</p>
                                <p className="text-[10px] text-stone-400">{s.hint}</p>
                              </div>
                            ))}
                          </div>
                          {e.history.length > 0 ? (
                            <ol className="space-y-1.5">
                              {e.history.slice(0, 5).map((h, i) => {
                                const d = Math.round((h.newScore - h.previousScore) * 100) / 100;
                                return (
                                  <li key={`${h.createdAt}-${i}`} className="flex items-center gap-2 text-xs text-stone-500">
                                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${h.source === "quiz" ? "bg-sky-100 text-sky-800" : h.source === "practice" ? "bg-violet-100 text-violet-800" : h.source === "flashcard" ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"}`}>
                                      {h.source ?? "seed"}
                                    </span>
                                    <span className="tnum">{Math.round(h.previousScore)} → {Math.round(h.newScore)}</span>
                                    <span className={`tnum font-semibold ${d > 0 ? "text-emerald-700" : d < 0 ? "text-red-700" : "text-stone-400"}`}>{d > 0 ? `+${d}` : d}</span>
                                    <span className="ml-auto text-[11px] text-stone-400">{timeAgo(h.createdAt)}</span>
                                  </li>
                                );
                              })}
                            </ol>
                          ) : (
                            <p className="text-xs text-stone-400">No attempts yet — be the first: take a quiz, practice, or review flashcards.</p>
                          )}
                          <div className="flex flex-wrap gap-1.5">
                            <Link href={`/projects/${projectId}/quiz`} className="rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700">Quiz</Link>
                            <Link href={`/projects/${projectId}/practice`} className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100">Practice</Link>
                            <Link href={`/projects/${projectId}/flashcards`} className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100">Cards</Link>
                            <Link href={`/projects/${projectId}/tutor?q=${encodeURIComponent(`Explain ${e.conceptName}`)}`} className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100">
                              <ChatIcon className="h-3 w-3" /> Tutor
                            </Link>
                            <Link href={`/projects/${projectId}/concepts`} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-800">Sub-concepts →</Link>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
