import { describe, it, expect } from "vitest";
import { filterCitationsToEvidence, type TutorResponse } from "@/ai/tutor";

const base: TutorResponse = {
  answer: "Photosynthesis has light-dependent reactions.",
  confidence: "high",
  grounded: true,
  citations: [
    { materialId: "m1", materialName: "Biology.pdf", page: 18, chunkId: "c1" },
    { materialId: "m1", materialName: "Biology.pdf", page: 19, chunkId: "c2" },
  ],
  followUpSuggestion: "Ask about the Calvin cycle next.",
};

describe("filterCitationsToEvidence", () => {
  it("keeps all citations when every chunkId was retrieved", () => {
    const out = filterCitationsToEvidence(base, new Set(["c1", "c2", "c3"]));
    expect(out).toEqual(base);
    expect(out.grounded).toBe(true);
  });

  it("drops hallucinated citations but keeps valid ones (grounded stays)", () => {
    const out = filterCitationsToEvidence(base, ["c1"]);
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0].chunkId).toBe("c1");
    expect(out.grounded).toBe(true);
    expect(out.confidence).toBe("high");
  });

  it("downgrades to ungrounded/low when NO cited chunk was retrieved", () => {
    const out = filterCitationsToEvidence(base, new Set(["other"]));
    expect(out.citations).toHaveLength(0);
    expect(out.grounded).toBe(false);
    expect(out.confidence).toBe("low");
    // answer text preserved — UI still shows it, just not as grounded
    expect(out.answer).toBe(base.answer);
  });

  it("passes through citation-free responses untouched (insufficient/inventory)", () => {
    const noCite: TutorResponse = { ...base, grounded: false, confidence: "low", citations: [] };
    expect(filterCitationsToEvidence(noCite, new Set())).toEqual(noCite);
    const inventory: TutorResponse = { ...base, citations: [] }; // grounded via materials list
    const out = filterCitationsToEvidence(inventory, new Set(["c9"]));
    expect(out.grounded).toBe(true);
    expect(out.citations).toHaveLength(0);
  });
});
