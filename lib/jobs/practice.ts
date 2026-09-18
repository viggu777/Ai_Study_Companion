import { inngest } from "./client";

export const practiceCompletedFunction = (inngest as unknown as { createFunction: (...args: unknown[]) => unknown }).createFunction(
  { id: "practice-recommendation", trigger: { event: "practice/completed" } },
  async ({
    event,
    step,
  }: {
    event: { data: { assignmentId: string; projectId: string; userId: string; spaceId?: string | null } };
    step: { run: (id: string, fn: () => Promise<unknown>) => Promise<unknown> };
  }) => {
    const { assignmentId, projectId, userId, spaceId } = event.data;
    if (!assignmentId || !projectId || !userId) throw new Error("Missing assignmentId/projectId/userId in practice/completed event");

    const result = (await step.run("generate-recommendation", async () => {
      const { generateRecommendationForProject } = await import("@/services/recommendation.service");
      try {
        return await generateRecommendationForProject({ projectId, userId, spaceId: spaceId ?? null });
      } catch (err) {
        // No weak concepts (all strong after practice) is a healthy no-op, not a failure.
        console.log("practice recommendation skipped:", err instanceof Error ? err.message : String(err));
        return null;
      }
    })) as { id: string; title: string } | null;

    return { assignmentId, projectId, recommendation: result };
  }
);

export const functions = [practiceCompletedFunction as unknown as never];
