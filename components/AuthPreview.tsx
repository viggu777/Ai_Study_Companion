"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { BookIcon, ChatIcon, SparkIcon, TargetIcon } from "@/components/icons";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Static product preview for the pre-login auth pages — real UI shapes
 * (tutor answer + citation, mastery card + progress bar, recommendation)
 * with mock content. Rotates every few seconds; no data fetching.
 */
export default function AuthPreview() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setIndex((i) => (i + 1) % 3), 5500);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div aria-live="polite">
      <div className="relative min-h-[248px]">
        <PreviewCard active={index === 0} label="Tutor answer preview">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
              <ChatIcon className="h-4 w-4" />
            </span>
            <p className="text-[13px] font-semibold text-stone-900">Tutor</p>
            <Badge tone="accent" className="ml-auto">
              Grounded
            </Badge>
          </div>
          <p className="mt-3 text-[13px] font-medium text-stone-900">
            Why do the light reactions need photosystems I and II?
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600">
            Photosystem II splits water to release electrons; photosystem I
            re-energizes them to make NADPH. Together they produce the ATP and
            NADPH the Calvin cycle runs on.
          </p>
          <p className="mt-3 flex items-center gap-1.5 border-t border-stone-100 pt-2.5 text-xs text-stone-500">
            <BookIcon className="h-3.5 w-3.5 shrink-0 text-sky-700" />
            Source: Biology Ch4.pdf — Page 18
          </p>
        </PreviewCard>

        <PreviewCard active={index === 1} label="Mastery card preview">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
              <TargetIcon className="h-4 w-4" />
            </span>
            <p className="text-[13px] font-semibold text-stone-900">Mastery</p>
            <Badge tone="danger" className="ml-auto">
              Requires attention
            </Badge>
          </div>
          <p className="mt-3 text-[13px] font-medium text-stone-900">
            Photosynthesis — Light Reactions
          </p>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-sky-100"
            role="progressbar"
            aria-valuenow={32}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Mastery score"
          >
            <div className="h-full w-[32%] rounded-full bg-sky-600" />
          </div>
          <p className="tnum mt-2 text-xs text-stone-500">32/100 · 3 quizzes · last attempt 40</p>
        </PreviewCard>

        <PreviewCard active={index === 2} label="Recommendation preview">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
              <SparkIcon className="h-4 w-4" />
            </span>
            <p className="text-[13px] font-semibold text-stone-900">Recommended next</p>
          </div>
          <p className="mt-3 text-[13px] font-medium text-stone-900">
            Strengthen Light Reactions before the Calvin Cycle
          </p>
          <ul className="mt-2 space-y-1.5">
            {[
              "Re-read Biology Ch4.pdf, pp. 18–24",
              "Ask Tutor to explain photosystems I vs II",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] text-stone-600">
                <span
                  aria-hidden
                  className="tnum mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-50 text-[11px] font-semibold text-stone-800"
                >
                  {i + 1}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </PreviewCard>
      </div>

      <div className="mt-4 flex items-center gap-1.5" role="tablist" aria-label="Preview selector">
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={index === i}
            aria-label={["Tutor answer", "Mastery card", "Recommendation"][i]}
            onClick={() => setIndex(i)}
            className={cx(
              "h-1.5 rounded-full transition-all",
              index === i ? "w-6 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70"
            )}
          />
        ))}
      </div>
    </div>
  );
}

function PreviewCard({
  active,
  label,
  children,
}: {
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-label={label}
      aria-hidden={!active}
      className={cx(
        "rounded-2xl bg-white/95 p-5 shadow-card-hover backdrop-blur transition-all duration-500",
        active
          ? "relative z-10 opacity-100"
          : "pointer-events-none absolute inset-0 z-0 translate-y-2 opacity-0"
      )}
    >
      {children}
    </div>
  );
}
