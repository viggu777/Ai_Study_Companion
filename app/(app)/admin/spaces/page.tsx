import { requireAdmin } from "@/lib/auth/admin";
import Link from "next/link";
import { listAdminSpaces } from "@/services/admin.service";

export const dynamic = "force-dynamic";

export default async function AdminSpacesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; userId?: string }>;
}) {
  await requireAdmin();

  const resolved = (await searchParams) ?? {};
  const q = resolved.q?.trim() ?? undefined;
  const userId = resolved.userId?.trim() ?? undefined;

  let spaces: Awaited<ReturnType<typeof listAdminSpaces>> = [];
  let error: string | null = null;
  try {
    spaces = await listAdminSpaces({ q, userId, limit: 100 });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Spaces</h1>
      <p className="text-sm text-stone-500">All workspaces (service role). Filter via query string.</p>

      <form method="GET" className="flex flex-wrap gap-2 items-end bg-white border border-stone-200 rounded-lg p-4">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-stone-700 mb-1">Search name (ilike)</label>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="e.g. biology"
            className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex-1 min-w-[260px]">
          <label className="block text-xs font-medium text-stone-700 mb-1">Filter user_id</label>
          <input
            name="userId"
            defaultValue={userId ?? ""}
            placeholder="uuid of user"
            className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm font-mono"
          />
        </div>
        <button type="submit" className="px-4 py-1.5 bg-sky-600 text-white rounded-md text-sm font-medium hover:bg-sky-700">
          Filter
        </button>
        {(q || userId) && (
          <Link href="/admin/spaces" className="px-4 py-1.5 bg-stone-100 text-stone-700 rounded-md text-sm hover:bg-stone-200">
            Clear
          </Link>
        )}
      </form>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      ) : spaces.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-lg p-8 text-center text-sm text-stone-500">
          No spaces match the current filter.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-card border border-stone-200 overflow-hidden">
          <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 border-b">
            Showing {spaces.length} spaces {q ? `matching "${q}"` : ""} {userId ? `for user ${userId.slice(0, 8)}…` : ""}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Space</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Projects</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">User</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {spaces.map((s) => (
                  <tr key={s.id} className="hover:bg-stone-50">
                    <td className="px-4 py-2">
                      <div className="font-medium text-stone-900">{s.name}</div>
                      <div className="text-xs font-mono text-stone-400">{s.id.slice(0, 8)}…</div>
                      {s.description && <div className="text-xs text-stone-500 truncate max-w-xs">{s.description}</div>}
                    </td>
                    <td className="px-4 py-2 text-stone-700 tnum">{s.projectCount}</td>
                    <td className="px-4 py-2 font-mono text-xs text-stone-600">{s.user_id.slice(0, 8)}…</td>
                    <td className="px-4 py-2 text-xs text-stone-600">{new Date(s.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-stone-400 px-4 py-3 border-t">
            Source: <code className="bg-stone-100 px-1 rounded">getServiceDb().from(&quot;spaces&quot;).select(...)</code> — service role bypasses RLS.
          </p>
        </div>
      )}
    </div>
  );
}
