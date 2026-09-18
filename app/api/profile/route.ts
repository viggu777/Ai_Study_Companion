import { NextResponse } from "next/server";
import { createClient } from "@/lib/auth/supabase/server";
import { displayNameOf } from "@/components/avatar";

/**
 * Self profile — display name shown in the sidebar / top bar (stored in auth
 * user_metadata so no migration is needed) + password change.
 */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    email: user.email ?? null,
    display_name: displayNameOf(user),
    created_at: user.created_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
  });
}

export async function PATCH(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payload = (body ?? {}) as { display_name?: unknown; password?: unknown };
  const hasName = payload.display_name !== undefined;
  const hasPassword = payload.password !== undefined;

  if (!hasName && !hasPassword) {
    return NextResponse.json({ error: "Nothing to update — provide display_name and/or password" }, { status: 400 });
  }

  let name: string | null = null;
  if (hasName) {
    name = typeof payload.display_name === "string" ? payload.display_name.trim() : "";
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    if (name.length > 60) return NextResponse.json({ error: "Name is too long (max 60)" }, { status: 400 });
  }

  let password: string | null = null;
  if (hasPassword) {
    password = typeof payload.password === "string" ? payload.password : "";
    if (password.length < 6) return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    if (password.length > 72) return NextResponse.json({ error: "Password is too long (max 72)" }, { status: 400 });
  }

  const { data, error: updateError } = await supabase.auth.updateUser({
    ...(password ? { password } : {}),
    ...(name !== null
      ? { data: { ...((user.user_metadata as Record<string, unknown> | null) ?? {}), display_name: name } }
      : {}),
  });
  if (updateError || !data.user) {
    return NextResponse.json({ error: updateError?.message ?? "Failed to save profile" }, { status: 500 });
  }
  return NextResponse.json({
    email: data.user.email ?? null,
    display_name: displayNameOf(data.user),
    updated_password: Boolean(password),
  });
}
