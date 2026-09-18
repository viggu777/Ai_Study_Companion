import { requireAdmin } from "@/lib/auth/admin";
import { getAdminDashboardCounts } from "@/services/admin.service";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  await requireAdmin();

  let counts: Awaited<ReturnType<typeof getAdminDashboardCounts>> | null = null;
  let error: string | null = null;
  try {
    counts = await getAdminDashboardCounts();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Overview</h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          Failed to load counts: {error}
          <p className="text-xs text-red-600 mt-2">
            Hint: ensure SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are set and migrations 001/002 applied.
          </p>
        </div>
      </div>
    );
  }

  if (!counts) return null;

  const cards: Array<{ label: string; value: string | number; sub: string }> = [
    { label: "Users", value: counts.userCount ?? "—", sub: counts.userCountError ? `fallback: ${counts.userCountError.slice(0, 80)}` : "auth.users via admin API" },
    { label: "Spaces", value: counts.spaceCount, sub: "spaces count(*)" },
    { label: "Projects", value: counts.projectCount, sub: "projects count(*)" },
    { label: "Materials", value: counts.materialCount, sub: "materials count(*)" },
    { label: "Concepts", value: counts.conceptCount, sub: "concepts count(*)" },
    { label: "Quizzes", value: counts.quizCount, sub: "quizzes count(*)" },
    { label: "Answers", value: counts.answerCount, sub: "answers count(*)" },
    { label: "AI Operations", value: counts.aiOperationsCount, sub: "ai_operations count(*)" },
    { label: "Learning Events", value: counts.learningEventsCount, sub: "learning_events count(*)" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Overview</h1>
        <p className="text-sm text-stone-500 mt-1">
          High-level counts across all users — live queries via service role (bypass RLS). Verify with:{" "}
          <code className="bg-stone-100 px-1 rounded text-xs">SELECT count(*) FROM &lt;table&gt;</code>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-lg shadow-card border border-stone-200 p-5">
            <div className="text-xs font-medium text-stone-500 uppercase tracking-wider">{c.label}</div>
            <div className="text-3xl font-bold text-stone-900 mt-1">{c.value}</div>
            <div className="text-xs text-stone-400 mt-1 truncate">{c.sub}</div>
          </div>
        ))}
      </div>

      <p className="text-xs text-stone-400">
        Users count via <code className="bg-stone-100 px-1 rounded">supabase.auth.admin.listUsers</code> (fallback: distinct user_id from projects/spaces). Other counts via{" "}
        <code className="bg-stone-100 px-1 rounded">getServiceDb().from(&lt;table&gt;).select(&quot;id&quot;, &#123; count: &quot;exact&quot;, head: true &#125;)</code>.
      </p>
    </div>
  );
}
