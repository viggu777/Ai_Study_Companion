import { describe, it, expect } from "vitest";
import {
  parseSpaceBody,
  parseProjectBody,
  parseQuizGenerateBody,
  parseQuizSubmitBody,
  parseRecommendationStatusBody,
} from "@/lib/validation/schemas";

describe("R33 validation schemas", () => {
  it("rejects empty space name", () => {
    expect(parseSpaceBody({ name: "   " }).ok).toBe(false);
    expect(parseSpaceBody({ name: 123 }).ok).toBe(false);
    expect(parseSpaceBody(null).ok).toBe(false);
  });

  it("accepts valid space body", () => {
    const r = parseSpaceBody({ name: " Math ", description: "d" });
    expect(r.ok).toBe(true);
    expect(r.data?.name).toBe("Math");
  });

  it("rejects overlong description", () => {
    expect(parseSpaceBody({ name: "A", description: "x".repeat(1001) }).ok).toBe(false);
  });

  it("rejects invalid quiz count", () => {
    expect(parseQuizGenerateBody({ count: 0 }).ok).toBe(false);
    expect(parseQuizGenerateBody({ count: 11 }).ok).toBe(false);
    expect(parseQuizGenerateBody({ count: 1.5 }).ok).toBe(false);
    expect(parseQuizGenerateBody({ count: "3" }).ok).toBe(false);
    expect(parseQuizGenerateBody({}).ok).toBe(true);
  });

  it("rejects invalid quiz submit", () => {
    expect(parseQuizSubmitBody({}).ok).toBe(false);
    expect(parseQuizSubmitBody({ questionId: "q", response: "" }).ok).toBe(false);
    expect(parseQuizSubmitBody({ questionId: "q", response: "x".repeat(10001) }).ok).toBe(false);
    expect(parseQuizSubmitBody({ question_id: "q1", answer: "ans" }).ok).toBe(true);
  });

  it("rejects invalid recommendation status", () => {
    expect(parseRecommendationStatusBody({ status: "NOPE" }).ok).toBe(false);
    expect(parseRecommendationStatusBody({}).ok).toBe(false);
    expect(parseRecommendationStatusBody({ status: "COMPLETED" }).ok).toBe(true);
  });

  it("rejects invalid project body", () => {
    expect(parseProjectBody({ name: "" }).ok).toBe(false);
    expect(parseProjectBody({ name: "P", learning_goal: 123 }).ok).toBe(false);
    expect(parseProjectBody({ name: "P", learning_goal: "x".repeat(2001) }).ok).toBe(false);
  });
});
