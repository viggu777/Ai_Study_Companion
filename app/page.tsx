import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase/server";

/**
 * Root route — previously had no page (404).
 * Logged-in users go straight into the app; everyone else to /login.
 */
export default async function RootPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}
