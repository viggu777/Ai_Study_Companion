import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { isAuthError } from "@/lib/auth/getCurrentUser";

describe("checkRateLimit — fixed window per key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  it("allows up to the limit then blocks with retryAfter", () => {
    const key = `t-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000).allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("tracks keys independently", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    expect(checkRateLimit(a, 1, 60_000).allowed).toBe(true);
    expect(checkRateLimit(a, 1, 60_000).allowed).toBe(false);
    expect(checkRateLimit(b, 1, 60_000).allowed).toBe(true);
  });

  it("resets after the window passes", () => {
    const key = `w-${Math.random()}`;
    expect(checkRateLimit(key, 1, 60_000).allowed).toBe(true);
    expect(checkRateLimit(key, 1, 60_000).allowed).toBe(false);
    vi.setSystemTime(1_000_000 + 61_000);
    expect(checkRateLimit(key, 1, 60_000).allowed).toBe(true);
  });
});

describe("isAuthError — route 401 mapping", () => {
  it("matches requireUserId Unauthorized", () => {
    expect(isAuthError(new Error("Unauthorized"))).toBe(true);
  });

  it("matches legacy NEXT_REDIRECT from getCurrentUserId", () => {
    expect(isAuthError(new Error("NEXT_REDIRECT"))).toBe(true);
  });

  it("does not match domain errors (stay 4xx/5xx)", () => {
    expect(isAuthError(new Error("Project not found"))).toBe(false);
    expect(isAuthError(new Error("Failed to fetch"))).toBe(false);
    expect(isAuthError("boom")).toBe(false);
  });
});
