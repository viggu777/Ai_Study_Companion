import { requireAdmin } from "@/lib/auth/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gate: redirect non-admin to /dashboard (spec: 403 or redirect)
  await requireAdmin();

  // No in-page tabs here — admin navigation lives in the global sidebar's
  // Administration section, so pages render content only.
  return <div className="min-w-0 flex-1">{children}</div>;
}
