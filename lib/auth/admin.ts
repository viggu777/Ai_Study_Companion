/**
 * Admin gating — architecture.md §14 / build-prompts.md phase 14
 *
 * Prototype approach (documented per spec):
 * - Gate via hardcoded allow-list: env `ADMIN_EMAILS` (comma-separated emails)
 *   and/or `ADMIN_USER_IDS` (comma-separated uuids). Production would add
 *   `profiles.is_admin boolean` column with RLS policy `is_admin = true` and
 *   service-layer checks; this allow-list avoids a migration for the 2-3 day
 *   prototype while still enforcing server-side gating.
 * - `ADMIN_EMAILS` check is case-insensitive, trimmed. If neither var is set,
 *   no user is admin (all /admin/* redirects to /dashboard).
 * - For local dev without allow-list, set `ADMIN_EMAILS` to your login email.
 * - Every admin layout/page MUST call `requireAdmin()` before querying with
 *   the service role; route handlers for admin APIs must do the same.
 *
 * Never trust client-supplied is_admin flag; always resolve from session.
 */

import { getCurrentUser } from "./getCurrentUser";
import { redirect } from "next/navigation";

function parseList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function parseEmailSet(): Set<string> {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function parseUserIdSet(): Set<string> {
  return parseList(process.env.ADMIN_USER_IDS);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const emails = parseEmailSet();
  return emails.has(email.toLowerCase().trim());
}

export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return parseUserIdSet().has(userId);
}

export function isAdminUser(user: { id: string; email?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return isAdminEmail(user.email) || isAdminUserId(user.id);
}

/**
 * Guard for server components / route handlers. If not admin, redirects to
 * /dashboard (404 would also be acceptable per spec; redirect avoids leaking
 * that /admin exists to logged-in non-admins).
 */
export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!isAdminUser(user)) {
    redirect("/dashboard");
  }
  return user;
}

/**
 * Non-redirecting check — useful for conditional UI or API that wants 403.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    return isAdminUser(user);
  } catch {
    return false;
  }
}
