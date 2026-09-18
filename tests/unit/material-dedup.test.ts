import { describe, it, expect } from "vitest";
import { computeFileHash } from "@/services/material.service";

describe("computeFileHash — duplicate-upload guard", () => {
  it("is deterministic for identical bytes", () => {
    const a = computeFileHash(Buffer.from("hello world"));
    const b = computeFileHash(Buffer.from("hello world"));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different bytes", () => {
    const a = computeFileHash(Buffer.from("file v1"));
    const b = computeFileHash(Buffer.from("file v2"));
    expect(a).not.toBe(b);
  });

  it("differs on a single-byte change (no collision shortcut)", () => {
    const base = Buffer.from([0, 1, 2, 3, 4]);
    const mutated = Buffer.from([0, 1, 2, 3, 5]);
    expect(computeFileHash(base)).not.toBe(computeFileHash(mutated));
  });
});
