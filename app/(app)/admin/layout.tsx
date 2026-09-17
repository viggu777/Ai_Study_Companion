import { requireAdmin } from "@/lib/auth/admin";
import Link from "next/link";

const nav: Array<{ href: string; label: string }> = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/projects", label: "Projects" },
  { href: "/admin/activity", label: "Activity" },
  { href: "/admin/ai-usage", label: "AI Usage" },
  { href: "/admin/ai-evaluation", label: "AI Evaluation" },
  { href: "/admin/jobs", label: "Jobs" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gate: redirect non-admin to /dashboard (spec: 403 or redirect)
  await requireAdmin();

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      {/* Admin section sidebar (the global app sidebar already covers top-level nav) */}
      <aside className="w-full shrink-0 md:w-52">
        <div className="rounded-lg border border-stone-200 bg-white p-3 md:sticky md:top-6">
          <p className="px-2 mb-2 text-[11px] font-semibold uppercase tracking-widest text-stone-400">
            Admin section
          </p>
          <nav>
            <ul className="flex flex-row flex-wrap gap-1 md:flex-col">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block rounded-md px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <Link
            href="/dashboard"
            className="mt-2 block rounded-md px-3 py-2 text-sm font-medium text-stone-500 hover:bg-stone-100"
          >
            ← Back to app
          </Link>
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
