/**
 * Live smoke test (Part 5) — requires dev server + real Supabase (.env.local).
 * Usage: npm run dev  (then)  npx tsx scripts/smoke-live.ts [baseUrl]
 *
 * Walks: signup-metadata → profile → space → project → empty recommendations →
 * cross-user 404s → malformed JSON 400s → delete 404s → logout.
 * Cleans up created users/data. Exits non-zero on any FAILED check.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3001";

function loadEnv(): void {
  const raw = fs.readFileSync(".env.local", "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const REF = new globalThis.URL(SUPABASE_URL).hostname.split(".")[0];
const COOKIE = `sb-${REF}-auth-token`;

let failures = 0;
function check(label: string, cond: boolean, extra?: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}

/** Build a Cookie header the @supabase/ssr server client accepts. */
function cookieHeader(session: unknown): string {
  const value = JSON.stringify(session);
  const enc = encodeURIComponent(value);
  if (enc.length <= 3000) return `${COOKIE}=${enc}`;
  const chunks: string[] = [];
  for (let i = 0; i < enc.length; i += 3000) chunks.push(enc.slice(i, i + 3000));
  return chunks.map((c, i) => `${COOKIE}.${i}=${c}`).join("; ");
}

async function api(
  method: string,
  path: string,
  cookie: string | null,
  body?: unknown,
  rawBody?: string
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined || rawBody !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

const stamp = Date.now().toString(36);
const emailA = `smoke-a-${stamp}@example.com`;
const emailB = `smoke-b-${stamp}@example.com`;
const PASS = "SmokeTest123!";

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });

  // --- create two confirmed users (A carries a signup display_name) ---
  for (const [email, meta] of [
    [emailA, { display_name: "Alice Smoke" }],
    [emailB, {}],
  ] as const) {
    const { error } = await admin.auth.admin.createUser({
      email,
      password: PASS,
      email_confirm: true,
      user_metadata: meta,
    });
    check(`create user ${email}`, !error, error?.message);
  }

  const signIn = async (email: string) => {
    const { data, error } = await anon.auth.signInWithPassword({ email, password: PASS });
    check(`sign in ${email}`, !error && !!data.session, error?.message);
    return data.session!;
  };
  const sessionA = await signIn(emailA);
  const sessionB = await signIn(emailB);
  const cookieA = cookieHeader(sessionA);
  const cookieB = cookieHeader(sessionB);
  const userA = sessionA.user.id;

  // --- unauthenticated ---
  check("GET /api/spaces unauthenticated → 401", (await api("GET", "/api/spaces", null)).status === 401);
  check(
    "GET /api/profile unauthenticated → 401",
    (await api("GET", "/api/profile", null)).status === 401
  );

  // --- Part 1: signup name persisted in metadata, served by profile ---
  const prof = await api("GET", "/api/profile", cookieA);
  check("GET /api/profile → 200 with signup display_name", prof.status === 200, JSON.stringify(prof.json));
  check(
    "display_name is Alice Smoke",
    (prof.json as { display_name?: string } | null)?.display_name === "Alice Smoke"
  );

  const patch = await api("PATCH", "/api/profile", cookieA, { display_name: "Alice S" });
  check("PATCH /api/profile → 200", patch.status === 200, JSON.stringify(patch.json));
  const badName = await api("PATCH", "/api/profile", cookieA, { display_name: "  " });
  check("PATCH /api/profile empty name → 400", badName.status === 400);

  // --- onboarding path: first space via POST /api/spaces ---
  const space = await api("POST", "/api/spaces", cookieA, { name: "Smoke Space" });
  check("POST /api/spaces → 201", space.status === 201, JSON.stringify(space.json)?.slice(0, 120));
  const spaceId = (space.json as { id: string }).id;
  const badJson = await api("POST", "/api/spaces", cookieA, undefined, "{not json");
  check("POST /api/spaces malformed JSON → 400", badJson.status === 400);

  const proj = await api("POST", `/api/spaces/${spaceId}/projects`, cookieA, { name: "Smoke Project" });
  check("POST project → 201", proj.status === 201);
  const projectId = (proj.json as { id: string }).id;

  // --- recommendations empty state (must be [] not 404) ---
  const recs = await api("GET", `/api/projects/${projectId}/recommendations`, cookieA);
  check(
    "GET recommendations (empty) → 200 []",
    recs.status === 200 && Array.isArray((recs.json as { recommendations?: unknown })?.recommendations),
    JSON.stringify(recs.json)?.slice(0, 120)
  );
  const concepts = await api("GET", `/api/projects/${projectId}/concepts`, cookieA);
  check("GET concepts (empty) → 200", concepts.status === 200);

  // --- cross-user: B must get 404 (never data, never 403 oracle) ---
  check("B GET A's project → 404", (await api("GET", `/api/projects/${projectId}`, cookieB)).status === 404);
  check("B GET A's space → 404", (await api("GET", `/api/spaces/${spaceId}`, cookieB)).status === 404);
  check(
    "B PATCH A's project → 404 (was 500)",
    (await api("PATCH", `/api/projects/${projectId}`, cookieB, { name: "hijack" })).status === 404
  );
  check(
    "B DELETE A's space → 404 (was false-200)",
    (await api("DELETE", `/api/spaces/${spaceId}`, cookieB)).status === 404
  );
  check(
    "B GET A's recommendations → 404",
    (await api("GET", `/api/projects/${projectId}/recommendations`, cookieB)).status === 404
  );

  // --- owner delete + verify gone ---
  check("A DELETE project → 200", (await api("DELETE", `/api/projects/${projectId}`, cookieA)).status === 200);
  check(
    "A DELETE project again → 404",
    (await api("DELETE", `/api/projects/${projectId}`, cookieA)).status === 404
  );
  check("A DELETE space → 200", (await api("DELETE", `/api/spaces/${spaceId}`, cookieA)).status === 200);

  // --- logout ---
  const logout = await api("POST", "/api/auth/logout", cookieA);
  check("POST /api/auth/logout → success", logout.status === 200);

  // --- markup: signup name field, login headline, no OAuth ---
  const signupHtml = await (await fetch(`${BASE}/signup`)).text();
  check("signup page has Name field", signupHtml.includes('name="name"'));
  // display_name persistence is asserted on source in tests/unit/route-audit.test.ts
  // (client-component JS isn't inlined in the document HTML).
  const loginHtml = await (await fetch(`${BASE}/login`)).text();
  check("login headline present", loginHtml.includes("Pick up where you left off"));
  check("no OAuth buttons", !/google|apple[^a-z]|oauth/i.test(signupHtml + loginHtml));

  // --- cleanup ---
  const { data: list } = await admin.auth.admin.listUsers();
  for (const u of list.users.filter((x) => x.email === emailA || x.email === emailB)) {
    await admin.auth.admin.deleteUser(u.id);
  }
  console.log(`\ncleanup: removed test users (A=${userA})`);
  console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE SCRIPT ERROR:", e);
  process.exit(1);
});
