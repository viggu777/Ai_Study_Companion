import { describe, it, expect } from "vitest";
import {
  normalizeConceptName,
  conceptDedupeKey,
  findDuplicateGroups,
  pickCanonicalConcept,
  filterFreshConcepts,
} from "@/lib/concepts/normalize";

describe("normalizeConceptName", () => {
  it("is case/whitespace/punctuation insensitive", () => {
    expect(normalizeConceptName("  Attention Mechanism ")).toBe("attention mechanism");
    expect(normalizeConceptName("Attention-Mechanism")).toBe("attention mechanism");
    expect(normalizeConceptName("ATTENTION  MECHANISM!")).toBe("attention mechanism");
    expect(normalizeConceptName("attention_mechanism")).toBe("attention mechanism");
  });

  it("strips diacritics", () => {
    expect(normalizeConceptName("naïve Bayes")).toBe("naive bayes");
  });

  it("returns empty for blank/punctuation-only names", () => {
    expect(normalizeConceptName("   ")).toBe("");
    expect(normalizeConceptName("---")).toBe("");
  });
});

describe("conceptDedupeKey", () => {
  it("treats same project+material+normalized name as one key", () => {
    const a = conceptDedupeKey("p1", "m1", "Attention Mechanism");
    const b = conceptDedupeKey("p1", "m1", "attention-mechanism ");
    expect(a).toBe(b);
  });

  it("separates different materials, projects and null sources", () => {
    const base = conceptDedupeKey("p1", "m1", "X");
    expect(conceptDedupeKey("p1", "m2", "X")).not.toBe(base);
    expect(conceptDedupeKey("p2", "m1", "X")).not.toBe(base);
    expect(conceptDedupeKey("p1", null, "X")).not.toBe(base);
  });
});

describe("findDuplicateGroups", () => {
  it("finds only true duplicate groups", () => {
    const rows = [
      { id: "1", project_id: "p", source_material_id: "m", name: "Alpha" },
      { id: "2", project_id: "p", source_material_id: "m", name: "alpha!" },
      { id: "3", project_id: "p", source_material_id: "m", name: "Beta" },
    ];
    const groups = findDuplicateGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((r) => r.id).sort()).toEqual(["1", "2"]);
  });

  it("ignores blank names and cross-material matches", () => {
    const rows = [
      { id: "1", project_id: "p", source_material_id: "m1", name: "Alpha" },
      { id: "2", project_id: "p", source_material_id: "m2", name: "Alpha" },
      { id: "3", project_id: "p", source_material_id: "m1", name: "   " },
      { id: "4", project_id: "p", source_material_id: "m1", name: "---" },
    ];
    expect(findDuplicateGroups(rows)).toHaveLength(0);
  });
});

describe("pickCanonicalConcept", () => {
  it("prefers the concept with the most questions", () => {
    const items = [
      { id: "a", created_at: "2024-01-02T00:00:00Z" },
      { id: "b", created_at: "2024-01-01T00:00:00Z" },
    ];
    expect(pickCanonicalConcept(items, { a: 5, b: 1 }).id).toBe("a");
  });

  it("breaks ties by oldest first", () => {
    const items = [
      { id: "a", created_at: "2024-01-02T00:00:00Z" },
      { id: "b", created_at: "2024-01-01T00:00:00Z" },
    ];
    expect(pickCanonicalConcept(items, { a: 0, b: 0 }).id).toBe("b");
  });
});

describe("filterFreshConcepts", () => {
  it("drops within-batch dupes and already-kept names", () => {
    const fresh = [{ name: "Alpha" }, { name: "alpha!" }, { name: "Beta" }, { name: "  " }];
    const out = filterFreshConcepts(fresh, ["beta"]);
    expect(out).toEqual([{ name: "Alpha" }]);
  });
});
