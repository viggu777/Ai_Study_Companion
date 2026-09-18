import { describe, it, expect } from "vitest";
import { CLAIMABLE_MATERIAL_STATUSES, canClaimMaterialStatus } from "@/services/material.service";
import { TUTOR_DEDUP_WINDOW_MS, isWithinDedupWindow } from "@/services/tutor.service";

describe("canClaimMaterialStatus — material job concurrency guard", () => {
  it("claims fresh uploads and failed rows (retry path)", () => {
    expect(canClaimMaterialStatus("QUEUED")).toBe(true);
    expect(canClaimMaterialStatus("FAILED")).toBe(true);
  });

  it("never claims READY (done) or PROCESSING (owned by a live worker)", () => {
    expect(canClaimMaterialStatus("READY")).toBe(false);
    expect(canClaimMaterialStatus("PROCESSING")).toBe(false);
  });

  it("rejects unknown statuses", () => {
    expect(canClaimMaterialStatus("")).toBe(false);
    expect(canClaimMaterialStatus("queued")).toBe(false);
    expect(canClaimMaterialStatus("DELETED")).toBe(false);
  });

  it("SQL claim list matches the helper (no drift)", () => {
    expect([...CLAIMABLE_MATERIAL_STATUSES].sort()).toEqual(["FAILED", "QUEUED"]);
  });
});

describe("isWithinDedupWindow — tutor POST idempotency", () => {
  const now = Date.parse("2026-09-17T12:00:00.000Z");

  it("treats an identical question seconds ago as a duplicate", () => {
    expect(isWithinDedupWindow("2026-09-17T11:59:45.000Z", now)).toBe(true);
  });

  it("treats an identical question past the window as a fresh ask", () => {
    expect(isWithinDedupWindow("2026-09-17T11:59:00.000Z", now)).toBe(false);
  });

  it("rejects unparseable timestamps (fail open → normal generation)", () => {
    expect(isWithinDedupWindow("not-a-date", now)).toBe(false);
  });

  it("window is 30s", () => {
    expect(TUTOR_DEDUP_WINDOW_MS).toBe(30_000);
  });
});
