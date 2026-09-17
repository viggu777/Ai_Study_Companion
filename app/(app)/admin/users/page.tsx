import { requireAdmin } from "@/lib/auth/admin";
import { listAdminUsers } from "@/services/admin.service";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  await requireAdmin();

  let users: Awaited<ReturnType<typeof listAdminUsers>> = [];
  let error: string | null = null;
  try {
    users = await listAdminUsers({ perPage: 50, page: 1 });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Users</h1>
        <span className="text-xs text-stone-500">{users.length} users (via auth.admin.listUsers)</span>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      ) : users.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-lg p-8 text-center text-sm text-stone-500">
          No users found. Create a test account via /signup first.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-card border border-stone-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">User</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">ID</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Created</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Last sign in</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Projects</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase">Quizzes</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-stone-50">
                    <td className="px-4 py-2 font-medium text-stone-900">{u.email ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-stone-600">{u.id.slice(0, 8)}…</td>
                    <td className="px-4 py-2 text-stone-600">{u.created_at ? new Date(u.created_at).toLocaleString() : "—"}</td>
                    <td className="px-4 py-2 text-stone-600">{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "—"}</td>
                    <td className="px-4 py-2 text-stone-700">{u.projectCount}</td>
                    <td className="px-4 py-2 text-stone-700">{u.quizCount}</td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/admin/users/${u.id}`} className="text-stone-800 hover:text-stone-900 font-medium">
                        Drill-down →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-stone-400 px-4 py-3 border-t">
            Source: <code className="bg-stone-100 px-1 rounded">getServiceDb().auth.admin.listUsers</code> + per-user counts from projects/materials/quizzes. Click a user to see Projects → Activity → Assessments → Progress → Mastery → AI Usage.
          </p>
        </div>
      )}
    </div>
  );
}
