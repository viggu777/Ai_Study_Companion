import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-enter flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-card">
        <p className="tnum text-5xl font-semibold tracking-tight text-stone-800">404</p>
        <h1 className="mt-3 text-xl font-semibold tracking-tight text-stone-900">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-stone-500">
          This page doesn&apos;t exist or you don&apos;t have access to it.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-card transition-colors hover:bg-sky-700"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
