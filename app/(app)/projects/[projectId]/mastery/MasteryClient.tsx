"use client";

import { useState } from "react";
import { Badge, EmptyState } from "@/components/ui";
import { TargetIcon } from "@/components/icons";

export interface MasteryEntry {
  conceptId: string;
  conceptName: string;
  description: string | null;
  previousScore: number | null;
  currentScore: number | null;
  trend: "IMPROVING" | "STABLE" | "REQUIRES_ATTENTION";
  historyCount: number;
}

function trendTone(trend: MasteryEntry["trend"]): "success" | "neutral" | "danger" {
  if (trend === "IMPROVING") return "success";
  if (trend === "REQUIRES_ATTENTION") return "danger";
  return "neutral";
}

/**
 * Minimal-by-default concept cards: name + grip (bar + number) + trend.
 * Click expands in place (single expanded card) to reveal description,
 * previous score and history count.
 */
export default function MasteryClient({ entries }: { entries: MasteryEntry[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {entries.map((g) => {
        const expanded = expandedId === g.conceptId;
        const score = g.currentScore !== null ? Math.max(0, Math.min(100, g.currentScore)) : null;
        return (
          <button
            key={g.conceptId}
            type="button"
            onClick={() => setExpandedId(expanded ? null : g.conceptId)}
            aria-expanded={expanded}
            className={`rounded-xl border bg-white p-4 text-left shadow-card transition-all hover:shadow-card-hover ${
              expanded ? "border-sky-600/40 ring-1 ring-sky-600/20" : "border-stone-200"
            }`}
          >
            <div className="flex items-start gap-2">
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900" title={g.conceptName}>
                {g.conceptName}
              </h3>
              <Badge tone={trendTone(g.trend)}>{g.trend}</Badge>
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100" aria-label={`Mastery ${score !== null ? Math.round(score) : "untested"} of 100`}>
                <div
                  className="h-full rounded-full bg-sky-600 transition-all"
                  style={{ width: `${score ?? 0}%` }}
                />
              </div>
              <span className="tnum shrink-0 text-sm font-bold text-stone-900">
                {score !== null ? `${Math.round(score)}/100` : "—"}
              </span>
            </div>
            {expanded && (
              <div className="mt-3 border-t border-stone-100 pt-3">
                {g.description && (
                  <p className="text-sm leading-relaxed text-stone-600">{g.description}</p>
                )}
                <p className="mt-2 text-xs text-stone-400">
                  {g.previousScore !== null ? `Previous ${g.previousScore.toFixed(1)}` : "Not yet tested"} · history: {g.historyCount} point(s)
                </p>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
