"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import AuthPreview from "./AuthPreview";

export default function AuthShell({
  title,
  subtitle,
  switchText,
  switchHref,
  switchLabel,
  panelTitle,
  panelSubtitle,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  switchText: string;
  switchHref: string;
  switchLabel: string;
  panelTitle: string;
  panelSubtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="page-enter flex min-h-screen bg-stone-100">
      {/* Preview panel — live product shapes, static mock content */}
      <div className="relative hidden w-[46%] shrink-0 overflow-hidden bg-sky-600 lg:block">
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
            <h2 className="max-w-md text-[30px] font-semibold leading-[1.15] tracking-tight text-white">
              {panelTitle}
            </h2>
            <p className="mt-2 max-w-md text-[15px] leading-relaxed text-white/75">
              {panelSubtitle}
            </p>
            <div className="mt-7 max-w-md">
              <AuthPreview />
            </div>
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
              className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-sky-600/10 text-base font-bold text-sky-700 ring-1 ring-inset ring-sky-600/20"
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
            <Link href={switchHref} className="font-medium text-stone-800 hover:text-stone-900">
              {switchLabel}
            </Link>
          </p>
          <div className="mt-7">{children}</div>
          <p className="mt-6 text-center text-xs text-stone-400">{switchText}</p>
        </div>
      </div>
    </main>
  );
}
