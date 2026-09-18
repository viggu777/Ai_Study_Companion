import { cache as reactCache } from "react";
import { createClient } from "./supabase/server";
import { redirect } from "next/navigation";

// `cache()` only exists in the React Server build (Next runtime). Unit tests
// import this module through the client `react` build where it is undefined,
// so fall back to a pass-through to keep services testable.
const cacheFn =
  typeof reactCache === "function"
    ? reactCache
    : <T extends (...args: Array<never>) => unknown>(fn: T): T => fn;

/**
 * Per-request cached user lookup.
 *
 * Before this change every call to getCurrentUser()/getCurrentUserId() issued
 * its own `supabase.auth.getUser()` network round-trip to the Supabase Auth
 * server — and a single page render calls it 3-5x (layout + page + each
 * service). React `cache()` dedupes those into ONE call per request, which is
 * the main reason page-to-page navigation felt slow.
 */
const getCachedUser = cacheFn(async () => {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
});

export async function getCurrentUser() {
  const user = await getCachedUser();

  if (!user) {
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
  const user = await getCachedUser();
  if (!user) throw new Error("Unauthorized");
  return user.id;
}

/** True for auth failures from either requireUserId() or getCurrentUserId(). */
export function isAuthError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("Unauthorized") || msg.includes("NEXT_REDIRECT");
}

/**
 * True when a service reports a missing/forbidden row ("... not found").
 * Ownership checks deliberately conflate the two (same string, same 404) so
 * callers can't probe for other users' ids.
 */
export function isNotFoundError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  return msg.includes("not found");
}