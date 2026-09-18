"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { BookIcon, ChatIcon, QuizIcon, SparkIcon } from "@/components/icons";

export interface RecommendedConcept {
  id: string;
  name: string;
  description: string | null;
  /** weakest-first score; null = untested (treated as 0 for ranking) */
  score: number | null;
  trend: "IMPROVING" | "STABLE" | "REQUIRES_ATTENTION";
  sourceMaterialId: string | null;
  materialName: string | null;
}

export interface ActiveRecommendation {
  id: string;
  title: string;
  action_items: string[];
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function trendTone(trend: RecommendedConcept["trend"]): "success" | "neutral" | "danger" {
  if (trend === "IMPROVING") return "success";
  if (trend === "REQUIRES_ATTENTION") return "danger";
  return "neutral";
}

function storageKey(projectId: string) {
  return `asc:rec-collapsed:${projectId}`;
}

function QuickTile({
  href,
  label,
  sub,
  tileClass,
  icon,
}: {
  href: string;
  label: string;
  sub: string;
  tileClass: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col items-center rounded-xl border border-stone-200 bg-white p-4 text-center shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
    >
      <span className={cx("flex h-12 w-full items-center justify-center rounded-lg text-white", tileClass)}>
        {icon}
      </span>
      <span className="mt-2.5 flex items-center gap-1 text-sm font-semibold text-stone-900">
        {label}
        <span aria-hidden className="text-stone-300 transition-transform group-hover:translate-x-0.5">→</span>
      </span>
      <span className="mt-0.5 text-xs text-stone-400">{sub}</span>
    </Link>
  );
}

/**
 * "Recommended from your study plan" — pill row of weakest-first concepts
 * (same ranking + source as the Mastery page), a Topic X-of-Y focus header
 * with Skip, the literal active-recommendation content, and three quick
 * actions into already-built pages. Additive: renders nothing extra when
 * there are no concepts beyond a compact upload nudge.
 */
export default function RecommendedNextAction({
  projectId,
  projectName,
  concepts,
  activeRecommendation,
}: {
  projectId: string;
  projectName: string;
  concepts: RecommendedConcept[];
  activeRecommendation: ActiveRecommendation | null;
}) {
  const [index, setIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(storageKey(projectId)) === "1");
    } catch {
      // storage unavailable — section stays expanded
    }
  }, [projectId]);

  const toggle = () => {
    setCollapsed((v) => {
      try {
        window.localStorage.setItem(storageKey(projectId), v ? "0" : "1");
      } catch {
        // ignore
      }
      return !v;
    });
  };

  if (concepts.length === 0) {
    return (
      <Card className="mt-6 p-5">
        <div className="flex items-center gap-2">
          <SparkIcon className="h-4 w-4 text-stone-800" />
          <h2 className="text-sm font-semibold text-stone-900">Recommended next action</h2>
        </div>
        <p className="mt-2 text-sm text-stone-500">
          Upload a PDF and complete a quiz — your weakest concepts will appear here with
          one-tap actions into Tutor, Materials and Quiz.
        </p>
        <Link
          href={`/projects/${projectId}/materials`}
          className="mt-3 inline-block text-xs font-medium text-sky-700 hover:text-sky-800"
        >
          Upload material →
        </Link>
      </Card>
    );
  }

  const safeIndex = Math.min(index, concepts.length - 1);
  const current = concepts[safeIndex];
  const tutorHref = `/projects/${projectId}/tutor?q=${encodeURIComponent(
    `Explain "${current.name}" simply using my study material`
  )}`;
  const materialsHref = current.sourceMaterialId
    ? `/projects/${projectId}/materials?material=${encodeURIComponent(current.sourceMaterialId)}`
    : `/projects/${projectId}/materials`;
  const quizHref = `/projects/${projectId}/quiz`;

  return (
    <section aria-label="Recommended next action" className="mt-6">
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <SparkIcon className="h-4 w-4 text-stone-800" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
            Recommended from your study plan
          </h2>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand recommended section" : "Collapse recommended section"}
            className="ml-auto rounded-md px-2 py-1 text-sm leading-none text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          >
            <span aria-hidden className={cx("inline-block transition-transform", collapsed ? "-rotate-90" : "")}>‹</span>
          </button>
        </div>

        {!collapsed && (
          <>
            {/* Concept pills — horizontally scrollable, never wraps */}
            <div
              className="tutor-pills -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1.5"
              role="listbox"
              aria-label="Recommended concepts"
            >
              {concepts.map((c, i) => {
                const active = i === safeIndex;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => setIndex(i)}
                    title={c.name}
                    className={cx(
                      "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-2 text-[13px] font-medium shadow-card transition-colors",
                      active
                        ? "border-sky-600/30 bg-sky-600/10 text-sky-900"
                        : "border-stone-200 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-50"
                    )}
                  >
                    <span className={cx("tnum text-xs", active ? "text-sky-700" : "text-stone-400")}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="max-w-[180px] truncate">{c.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Topic X of Y */}
            <div className="mt-4 border-t border-stone-100 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-stone-400">
                  Topic {safeIndex + 1} of {concepts.length} from {projectName}
                </p>
                <button
                  type="button"
                  onClick={() => setIndex((safeIndex + 1) % concepts.length)}
                  className="ml-auto text-xs font-medium text-stone-800 hover:text-stone-900"
                >
                  Skip →
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-stone-900" title={current.name}>
                  {current.name}
                </h3>
                <Badge tone={trendTone(current.trend)}>{current.trend}</Badge>
                <Badge tone="neutral">
                  {current.score !== null ? `${Math.round(current.score)}/100` : "untested"}
                </Badge>
              </div>
              {current.description && (
                <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-stone-500">
                  {current.description}
                </p>
              )}
              {current.materialName && (
                <p className="mt-1 text-xs text-stone-400">
                  From <span className="font-medium text-stone-600">{current.materialName}</span>
                </p>
              )}
              {/* Literal active-recommendation content — same row powering the card above */}
              {activeRecommendation && (
                <div className="mt-3 rounded-xl bg-stone-100/70 px-4 py-3">
                  <p className="text-[13px] font-medium text-stone-900">{activeRecommendation.title}</p>
                  {activeRecommendation.action_items.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {activeRecommendation.action_items.slice(0, 3).map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-[13px] text-stone-600">
                          <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-sky-600" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="mt-2 flex items-center gap-3">
                <Link
                  href={`/projects/${projectId}/mastery?concept=${encodeURIComponent(current.id)}`}
                  className="text-xs font-medium text-sky-700 hover:text-sky-800"
                >
                  View on Mastery →
                </Link>
              </div>
            </div>

            {/* Three quick actions into already-built pages */}
            <div className="mt-4 grid grid-cols-3 gap-3">
              <QuickTile
                href={tutorHref}
                label="Ask Tutor"
                sub="Ask about this topic"
                tileClass="bg-sky-600"
                icon={<ChatIcon className="h-6 w-6" />}
              />
              <QuickTile
                href={materialsHref}
                label="Review Material"
                sub={current.materialName ? "Open its source" : "Browse uploads"}
                tileClass="bg-amber-500"
                icon={<BookIcon className="h-6 w-6" />}
              />
              <QuickTile
                href={quizHref}
                label="Take Quiz"
                sub="Adaptive · weakest first"
                tileClass="bg-teal-600"
                icon={<QuizIcon className="h-6 w-6" />}
              />
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
