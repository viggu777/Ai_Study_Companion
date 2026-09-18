import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isAdminUser } from "@/lib/auth/admin";
import { displayNameOf } from "@/components/avatar";
import AppShell from "@/components/AppShell";

/**
 * Shared app shell — sidebar navigation for every authenticated route.
 * Individual pages no longer render their own top navbar; they render
 * content only (page title + body) inside the content column.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <AppShell
      userEmail={user.email ?? null}
      userName={displayNameOf(user)}
      isAdmin={isAdminUser(user)}
    >
      {children}
    </AppShell>
  );
}
