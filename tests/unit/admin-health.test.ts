import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeOverallStatus } from "@/services/admin.service";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("computeOverallStatus", () => {
  it("is HEALTHY when all critical checks are ok (jobs unconfigured is fine)", () => {
    expect(
      computeOverallStatus([
        { key: "database", status: "ok" },
        { key: "storage", status: "ok" },
        { key: "chat", status: "ok" },
        { key: "embeddings", status: "ok" },
        { key: "jobs", status: "not_configured" },
      ])
    ).toBe("HEALTHY");
  });

  it("is DEGRADED when the database is not ok", () => {
    for (const status of ["degraded", "unknown", "not_configured"] as const) {
      expect(
        computeOverallStatus([
          { key: "database", status },
          { key: "storage", status: "ok" },
          { key: "chat", status: "ok" },
          { key: "embeddings", status: "ok" },
          { key: "jobs", status: "ok" },
        ])
      ).toBe("DEGRADED");
    }
  });

  it("is DEGRADED on degraded storage, unconfigured chat, or degraded embeddings", () => {
    const base = [
      { key: "database", status: "ok" },
      { key: "storage", status: "ok" },
      { key: "chat", status: "ok" },
      { key: "embeddings", status: "ok" },
      { key: "jobs", status: "ok" },
    ] as Array<{ key: "database" | "storage" | "chat" | "embeddings" | "jobs"; status: "ok" | "degraded" | "not_configured" | "unknown" }>;
    expect(computeOverallStatus(base.map((c) => (c.key === "storage" ? { ...c, status: "degraded" as const } : c)))).toBe("DEGRADED");
    expect(computeOverallStatus(base.map((c) => (c.key === "chat" ? { ...c, status: "not_configured" as const } : c)))).toBe("DEGRADED");
    expect(computeOverallStatus(base.map((c) => (c.key === "embeddings" ? { ...c, status: "degraded" as const } : c)))).toBe("DEGRADED");
  });

  it("treats unknown probes as non-failing (page shows UNCHECKABLE, stays HEALTHY)", () => {
    expect(
      computeOverallStatus([
        { key: "database", status: "ok" },
        { key: "storage", status: "unknown" },
        { key: "chat", status: "ok" },
        { key: "embeddings", status: "unknown" },
        { key: "jobs", status: "unknown" },
      ])
    ).toBe("HEALTHY");
  });
});

describe("system health page wiring", () => {
  it("health page gates on requireAdmin and renders failure states safely", () => {
    const src = read("app/(app)/admin/health/page.tsx");
    expect(src).toContain("requireAdmin()");
    expect(src).toContain("getAdminSystemHealth()");
    expect(src).toContain('role="alert"');
    expect(src).toContain('role="status"');
    // No secret env values may leak into the rendered page.
    expect(src).not.toMatch(/API_KEY|SERVICE_ROLE|SIGNING_KEY/);
  });

  it("health service never embeds secret values in returned details", () => {
    const src = read("services/admin.service.ts");
    expect(src).toContain("getAdminSystemHealth");
    // Presence-only env reads; details interpolate only non-secret labels.
    expect(src).not.toMatch(/detail:.*process\.env\.(MERCURY_API_KEY|GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|INNGEST_SIGNING_KEY)\}/);
  });

  it("health is linked from the sidebar and topbar (single admin nav, no in-page tabs)", () => {
    // Admin navigation lives only in the global sidebar — the admin layout
    // renders page content directly with no duplicate tab bar.
    expect(read("app/(app)/admin/layout.tsx")).not.toContain("AdminNav");
    expect(read("components/Sidebar.tsx")).toContain("/admin/health");
    expect(read("components/TopBar.tsx")).toContain("health");
  });
});
