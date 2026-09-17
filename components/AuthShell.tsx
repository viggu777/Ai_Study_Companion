"use client";

import type { ReactNode } from "react";
import { BookIcon, ChatIcon, QuizIcon, TrendUpIcon } from "./icons";

const highlights = [
  { icon: BookIcon, title: "Upload once", text: "PDFs become searchable, cited knowledge." },
  { icon: ChatIcon, title: "Ask grounded", text: "A tutor that answers from your materials." },
  { icon: QuizIcon, title: "Test adaptively", text: "Quizzes target your weakest concepts." },
  { icon: TrendUpIcon, title: "Watch mastery grow", text: "Deterministic tracking, honest trends." },
];

export default function AuthShell({
  title,
  subtitle,
  switchText,
  switchHref,
  switchLabel,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  switchText: string;
  switchHref: string;
  switchLabel: string;
  children: ReactNode;
}) {
  return (
    <main className="page-enter flex min-h-screen bg-stone-100">
      {/* Brand panel */}
      <div className="relative hidden w-[44%] shrink-0 overflow-hidden bg-sky-600 lg:block">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.22),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(12,74,110,0.35),transparent_55%)]"
        />
        <div className="relative flex h-full flex-col justify-between p-10">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-white/20 text-base font-bold text-white"
            >
              A
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-white">
              AI Study Companion
            </span>
          </div>

          <div>
            <h2 className="max-w-md text-[32px] font-semibold leading-[1.15] tracking-tight text-white">
              Learn in a loop: read, ask, test, master.
            </h2>
            <ul className="mt-8 space-y-5">
              {highlights.map((h) => (
                <li key={h.title} className="flex items-start gap-3.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
                    <h.icon className="h-[18px] w-[18px]" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{h.title}</span>
                    <span className="block text-sm text-white/70">{h.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-white/60">
            Material → Tutor → Assessment → Mastery → Recommendation
          </p>
        </div>
      </div>

      {/* Form column */}
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-sky-600 text-base font-bold text-white"
            >
              A
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-stone-900">
              AI Study Companion
            </span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-stone-900">{title}</h1>
          <p className="mt-1.5 text-sm text-stone-500">
            {subtitle}{" "}
            <a href={switchHref} className="font-medium text-stone-800 hover:text-stone-900">
              {switchLabel}
            </a>
          </p>
          <div className="mt-7">{children}</div>
          <p className="mt-6 text-center text-xs text-stone-400">{switchText}</p>
        </div>
      </div>
    </main>
  );
}
