"use client";

import { createBrowserClient } from "@supabase/ssr";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (typeof window !== "undefined") {
      throw new Error("Missing Supabase environment variables");
    }
    // Return a mock client during build/SSR to avoid build failures
    return {
      auth: {
        signInWithPassword: async () => ({ error: new Error("Supabase not configured") }),
        signUp: async () => ({ error: new Error("Supabase not configured") }),
        signOut: async () => ({ error: new Error("Supabase not configured") }),
        getUser: async () => ({ data: { user: null }, error: new Error("Supabase not configured") }),
      },
    } as ReturnType<typeof createBrowserClient>;
  }

  browserClient = createBrowserClient(url, anonKey);
  return browserClient;
}