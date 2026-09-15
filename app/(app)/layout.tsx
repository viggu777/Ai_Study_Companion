import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isAdminUser } from "@/lib/auth/admin";
import Sidebar from "@/components/Sidebar";

/**
 * Shared app shell — sidebar navigation for every authenticated route.
 * Individual pages no longer render their own top navbar; they render
 * content only (page title + body) inside the content column.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen bg-stone-100">
      <Sidebar userEmail={user.email ?? null} isAdmin={isAdminUser(user)} />
      <div className="lg:pl-64">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
