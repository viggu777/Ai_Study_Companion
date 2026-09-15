import { createClient } from "@/lib/auth/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export async function getDb() {
  const supabase = await createClient();
  return supabase;
}

export function getServiceDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing Supabase service env vars");
  return createSupabaseClient(url, serviceKey);
}

export type Tables = {
  spaces: {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
  };
  projects: {
    id: string;
    space_id: string;
    user_id: string;
    name: string;
    description: string | null;
    learning_goal: string | null;
    created_at: string;
    updated_at: string;
  };
  learning_events: {
    id: string;
    user_id: string;
    space_id: string | null;
    project_id: string | null;
    event_type: string;
    entity_type: string;
    entity_id: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
  };
};