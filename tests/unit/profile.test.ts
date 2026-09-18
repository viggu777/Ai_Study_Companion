import { describe, it, expect } from "vitest";
import { displayNameOf, initialOf, avatarTone } from "@/components/avatar";
import { isNotFoundError, isAuthError } from "@/lib/auth/getCurrentUser";

describe("displayNameOf — real name first, never raw email", () => {
  it("prefers user_metadata.display_name", () => {
    expect(
      displayNameOf({ email: "jane@example.com", user_metadata: { display_name: "Jane Doe" } })
    ).toBe("Jane Doe");
  });

  it("falls back to full_name then name metadata", () => {
    expect(displayNameOf({ email: "a@b.c", user_metadata: { full_name: "Full Name" } })).toBe(
      "Full Name"
    );
    expect(displayNameOf({ email: "a@b.c", user_metadata: { name: "Nick" } })).toBe("Nick");
  });

  it("derives a readable name from the email prefix (not the raw email)", () => {
    const name = displayNameOf({ email: "john.doe_99@example.com", user_metadata: {} });
    expect(name).not.toContain("@");
    expect(name).toBe("John Doe 99");
  });

  it("falls back to Learner with no usable data", () => {
    expect(displayNameOf(null)).toBe("Learner");
    expect(displayNameOf({})).toBe("Learner");
  });

  it("trims and caps metadata names", () => {
    expect(displayNameOf({ user_metadata: { display_name: "  spaced  " } })).toBe("spaced");
  });
});

describe("initialOf", () => {
  it("upper-cases the first character", () => {
    expect(initialOf("kiran")).toBe("K");
    expect(initialOf(" Jane ")).toBe("J");
  });

  it("returns ? for missing names", () => {
    expect(initialOf(null)).toBe("?");
    expect(initialOf("")).toBe("?");
  });
});

describe("avatarTone — distinct soft tones per user", () => {
  it("is deterministic for the same seed", () => {
    expect(avatarTone("a@x.com")).toEqual(avatarTone("a@x.com"));
  });

  it("spreads users across tones (not everyone on blue)", () => {
    const tones = new Set(
      ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com", "f@x.com", "g@x.com"].map(
        (s) => avatarTone(s).bg
      )
    );
    expect(tones.size).toBeGreaterThan(1);
  });

  it("never returns a solid fill tone", () => {
    for (const seed of ["a@x.com", "b@x.com", null, undefined]) {
      const t = avatarTone(seed ?? undefined);
      expect(t.bg).toMatch(/\/10|\/15/);
      expect(t.bg).not.toMatch(/^bg-\w+-600$/);
    }
  });
});

describe("error classifiers", () => {
  it("isNotFoundError matches missing/foreign-row messages case-insensitively", () => {
    expect(isNotFoundError(new Error("Space not found"))).toBe(true);
    expect(isNotFoundError(new Error("Project NOT FOUND"))).toBe(true);
    expect(isNotFoundError(new Error("Chunk not found"))).toBe(true);
    expect(isNotFoundError(new Error("Failed to update space"))).toBe(false);
    expect(isNotFoundError(new Error("Unauthorized"))).toBe(false);
  });

  it("isAuthError still catches redirects and unauthorized", () => {
    expect(isAuthError(new Error("Unauthorized"))).toBe(true);
    expect(isAuthError(new Error("NEXT_REDIRECT"))).toBe(true);
    expect(isAuthError(new Error("Space not found"))).toBe(false);
  });
});
