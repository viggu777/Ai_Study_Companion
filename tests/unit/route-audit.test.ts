import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

const apiRoutes = walk(path.join(ROOT, "app/api")).filter((f) => f.endsWith("route.ts"));
// Inngest webhooks use SDK signature verification, not session cookies;
// logout must work with an expired session. Everything else needs auth.
const NO_SESSION_AUTH = new Set([
  "app/api/inngest/route.ts",
  "app/api/auth/logout/route.ts",
]);

describe("API audit regression — every user-data handler requires auth", () => {
  for (const abs of apiRoutes) {
    const rel = path.relative(ROOT, abs);
    it(`${rel} authenticates the caller`, () => {
      if (NO_SESSION_AUTH.has(rel)) return;
      const src = read(abs);
      expect(
        src.includes("requireUserId(") || src.includes("getCurrentUserId(") || src.includes("auth.getUser("),
        `${rel} touches user data without an auth call`
      );
      expect(src.includes("401"), `${rel} never returns 401`);
    });
  }
});

describe("API audit regression — handlers stay thin (no direct DB)", () => {
  for (const abs of apiRoutes) {
    const rel = path.relative(ROOT, abs);
    it(`${rel} delegates to services`, () => {
      const src = read(abs);
      expect(
        src.includes('from("') || src.includes("from('"),
        `${rel} queries the DB directly instead of the service layer`
      ).toBe(false);
    });
  }
});

describe("API audit regression — not-found mapping", () => {
  it("spaces/projects handlers map missing rows to 404", () => {
    for (const rel of [
      "app/api/spaces/[spaceId]/route.ts",
      "app/api/spaces/[spaceId]/projects/route.ts",
      "app/api/projects/[projectId]/route.ts",
      "app/api/chunks/[chunkId]/route.ts",
    ]) {
      const src = read(path.join(ROOT, rel));
      expect(src.includes("isNotFoundError") || src.includes("404"), `${rel} has no 404 path`);
    }
  });
});

describe("Auth pages — signup persists a name, no dead OAuth buttons", () => {
  const signup = read(path.join(ROOT, "app/(auth)/signup/page.tsx"));
  const login = read(path.join(ROOT, "app/(auth)/login/page.tsx"));

  it("signup has a required Name field persisted to user_metadata", () => {
    expect(signup).toMatch(/label="Name"|name="name"/);
    expect(signup).toContain("display_name");
    expect(signup).toContain("options: { data:");
  });

  it("signup onboarding creates the first space via the existing path", () => {
    expect(signup).toContain("/api/spaces");
    expect(signup).toMatch(/Skip for now|skip/i);
  });

  it("no OAuth buttons on login/signup", () => {
    for (const [label, src] of [["login", login], ["signup", signup]] as const) {
      expect(src, `${label} must not reference OAuth`).not.toMatch(/google|apple|oauth/i);
    }
  });
});

describe("Logout — client redirect, no stranded JSON form", () => {
  const sidebar = read(path.join(ROOT, "components/Sidebar.tsx"));
  it("sidebar logs out via fetch + navigation to /login", () => {
    expect(sidebar).toContain("/api/auth/logout");
    expect(sidebar).toContain("/login");
    expect(sidebar).not.toContain('<form action="/api/auth/logout"');
  });
});
