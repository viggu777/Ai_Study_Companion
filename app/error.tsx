"use client";

import Link from "next/link";
import { Button } from "@/components/ui";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="page-enter flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-600">
          Something went wrong
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-stone-900">
          This page hit an unexpected error
        </h1>
        <p className="mt-2 text-sm text-stone-500">
          {error.message || "An unexpected error occurred. Your data is safe — try again."}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 shadow-card transition-colors hover:bg-stone-50"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
