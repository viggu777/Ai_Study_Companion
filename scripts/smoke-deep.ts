/**
 * Deep-loop probe (manual): upload a tiny PDF → poll material status →
 * tutor question. Usage: npx tsx scripts/smoke-deep.ts [baseUrl]
 * Keeps its own users/data and cleans up. Non-zero exit on failure.
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
function cookieHeader(session: unknown): string {
  const enc = encodeURIComponent(JSON.stringify(session));
  if (enc.length <= 3000) return `${COOKIE}=${enc}`;
  const out: string[] = [];
  for (let i = 0; i < enc.length; i += 3000) out.push(enc.slice(i, i + 3000));
  return out.map((c, i) => `${COOKIE}.${i}=${c}`).join("; ");
}

// Real PDF fixture: pdf-parse's own valid test file (14 pages, real extractable
// text). A hand-made minimal PDF is NOT used — this pdf-parse build rejects
// minimal/hand-built xref tables ("bad XRef entry") even when pypdf accepts them,
// which would fail the probe for fixture reasons rather than app reasons.
const FIXTURE_PDF = "node_modules/pdf-parse/test/data/01-valid.pdf";
const TUTOR_QUESTION = "What is trace-based just-in-time type specialization?";

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const stamp = Date.now().toString(36);
  const email = `deep-${stamp}@example.com`;
  await admin.auth.admin.createUser({ email, password: "DeepTest123!", email_confirm: true });
  const { data } = await anon.auth.signInWithPassword({ email, password: "DeepTest123!" });
  const cookie = cookieHeader(data.session!);
  const H = { Cookie: cookie } as Record<string, string>;

  const space = await (await fetch(`${BASE}/api/spaces`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Deep Space" }),
  })).json() as { id: string };
  check("space created", !!space.id);
  const proj = await (await fetch(`${BASE}/api/spaces/${space.id}/projects`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Deep Project" }),
  })).json() as { id: string };
  check("project created", !!proj.id);

  if (!fs.existsSync(FIXTURE_PDF)) {
    console.error(`SCRIPT ERROR: fixture PDF missing: ${FIXTURE_PDF} (run npm install first)`);
    process.exit(1);
  }
  const fd = new FormData();
  fd.append("file", new Blob([fs.readFileSync(FIXTURE_PDF)], { type: "application/pdf" }), "smoke-valid.pdf");
  const upRes = await fetch(`${BASE}/api/projects/${proj.id}/materials`, {
    method: "POST", headers: H, body: fd,
  });
  const up = (await upRes.json().catch(() => null)) as { id?: string; status?: string; error?: string } | null;
  check("PDF upload accepted (202)", upRes.status === 202, `status=${upRes.status} ${JSON.stringify(up)?.slice(0, 160)}`);

  // Poll material status up to ~90s (direct fallback processes inline; statuses
  // are UPPERCASE: QUEUED → PROCESSING → READY / FAILED).
  let status: string | null = null;
  if (up?.id) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const list = (await (await fetch(`${BASE}/api/projects/${proj.id}/materials`, { headers: H })).json()) as Array<{ id: string; status: string }>;
      status = list.find((m) => m.id === up.id)?.status ?? null;
      if (status === "READY" || status === "FAILED") break;
    }
  }
  check("material processed to ready", status === "READY", `status=${status}`);

  if (status === "READY") {
    const tutorRes = await fetch(`${BASE}/api/projects/${proj.id}/tutor`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ question: TUTOR_QUESTION }),
    });
    const tutor = (await tutorRes.json().catch(() => null)) as { answer?: string; citations?: unknown[]; grounded?: boolean; error?: string } | null;
    check(
      "tutor answers with citation",
      tutorRes.status === 200 && !!tutor?.answer && Array.isArray(tutor?.citations) && tutor.citations.length > 0,
      `status=${tutorRes.status} ${JSON.stringify(tutor)?.slice(0, 200)}`
    );
    const quizRes = await fetch(`${BASE}/api/projects/${proj.id}/quiz`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    const quiz = (await quizRes.json().catch(() => null)) as { id?: string; quiz?: { id?: string }; error?: string } | null;
    check("quiz generated", quizRes.status === 201 && !!((quiz as { quiz?: { id?: string } })?.quiz?.id ?? (quiz as { id?: string })?.id), `status=${quizRes.status} ${JSON.stringify(quiz)?.slice(0, 160)}`);
  } else {
    console.log("SKIP  tutor/quiz probes — pipeline needs Inngest dev server (see report)");
  }

  await fetch(`${BASE}/api/projects/${proj.id}`, { method: "DELETE", headers: H });
  await fetch(`${BASE}/api/spaces/${space.id}`, { method: "DELETE", headers: H });
  const { data: list } = await admin.auth.admin.listUsers();
  for (const u of list.users.filter((x) => x.email === email)) await admin.auth.admin.deleteUser(u.id);
  console.log(failures === 0 ? "\nDEEP PROBE DONE — all executed checks passed" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("SCRIPT ERROR:", e); process.exit(1); });
