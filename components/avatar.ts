/**
 * Shared profile presentation helpers (client + server safe, pure functions).
 * Lives in components/ so Tailwind picks up the literal class strings.
 */

export interface AvatarTone {
  bg: string;
  text: string;
  ring: string;
}

/** Soft tinted tones — no solid fills, so no two users get a heavy blue disc. */
const TONES: AvatarTone[] = [
  { bg: "bg-sky-600/10", text: "text-sky-700", ring: "ring-sky-600/20" },
  { bg: "bg-teal-600/10", text: "text-teal-700", ring: "ring-teal-600/20" },
  { bg: "bg-violet-600/10", text: "text-violet-700", ring: "ring-violet-600/20" },
  { bg: "bg-amber-500/15", text: "text-amber-700", ring: "ring-amber-500/30" },
  { bg: "bg-rose-600/10", text: "text-rose-700", ring: "ring-rose-600/20" },
  { bg: "bg-emerald-600/10", text: "text-emerald-700", ring: "ring-emerald-600/20" },
];

/** Deterministic per-user tone derived from email, so users are distinguishable. */
export function avatarTone(seed: string | null | undefined): AvatarTone {
  if (!seed) return TONES[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

export interface ProfileUser {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

/** Display name: saved profile name → auth metadata → email prefix → fallback. */
export function displayNameOf(user: ProfileUser | null | undefined): string {
  const md = (user?.user_metadata ?? {}) as Record<string, unknown>;
  for (const key of ["display_name", "full_name", "name"]) {
    const v = md[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 60);
  }
  const email = user?.email;
  if (email && email.includes("@")) {
    const prefix = email
      .split("@")[0]
      .replace(/[._-]+/g, " ")
      .trim();
    if (prefix) return prefix.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "Learner";
}

export function initialOf(name: string | null | undefined): string {
  const c = name?.trim().charAt(0) ?? "";
  return c ? c.toUpperCase() : "?";
}
