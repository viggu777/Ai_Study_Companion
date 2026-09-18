import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("admin AI usage token/cost visibility", () => {
  it("always renders token and cost cards (never hidden when null)", () => {
    const src = read("app/(app)/admin/ai-usage/page.tsx");
    expect(src).toContain("Tokens in / out");
    expect(src).toContain("Est. cost");
    // The old conditional-hide pattern must be gone.
    expect(src).not.toContain("totalTokensIn !== null || usage.totalTokensOut !== null");
  });

  it("renders per-feature tokens/cost and a recent-calls table", () => {
    const src = read("app/(app)/admin/ai-usage/page.tsx");
    expect(src).toContain("tokensPerFeature");
    expect(src).toContain("Recent calls");
    expect(src).toContain("recentCalls");
    expect(src).toContain("Tokens in/out");
  });

  it("explains NULL legacy rows instead of hiding the section", () => {
    const src = read("app/(app)/admin/ai-usage/page.tsx");
    expect(src).toContain("NULL");
  });

  it("service aggregates per-feature tokens and recent calls", () => {
    const src = read("services/admin.service.ts");
    expect(src).toContain("tokensPerFeature");
    expect(src).toContain("recentCalls");
    expect(src).toContain("pricedCalls");
  });
});
