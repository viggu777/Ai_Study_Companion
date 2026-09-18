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
      const { refreshRecommendationAfterTask } = await import("@/services/recommendation.service");
      // Maintenance mode guarantees an ACTIVE row even when practice left
      // nothing weak — a completed practice always yields a next step.
      return await refreshRecommendationAfterTask({ projectId, userId, spaceId: spaceId ?? null, trigger: "practice/completed", force: true });
    })) as { id: string; title: string } | null;

    return { assignmentId, projectId, recommendation: result };
  }
);

export const functions = [practiceCompletedFunction as unknown as never];
