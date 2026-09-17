import { createClient } from "./supabase/server";
import { redirect } from "next/navigation";

export async function getCurrentUser() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  return user;
}

export async function getCurrentUserId() {
  const user = await getCurrentUser();
  return user.id;
}

/**
 * API-route-safe variant: throws Error("Unauthorized") instead of redirecting.
 * Use this in app/api/* handlers (and the services they call run in the same
 * request, so the inner getCurrentUserId() resolves too). Pages should keep
 * using getCurrentUser()/getCurrentUserId() for login redirects.
 */
export async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return user.id;
}

/** True for auth failures from either requireUserId() or getCurrentUserId(). */
export function isAuthError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("Unauthorized") || msg.includes("NEXT_REDIRECT");
}