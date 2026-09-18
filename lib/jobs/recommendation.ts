import { inngest } from "./client";

export const recommendationGenerateFunction = (inngest as unknown as { createFunction: (...args: unknown[]) => unknown }).createFunction(
  { id: "recommendation-generate", trigger: { event: "mastery/updated" } },
  async ({
    event,
    step,
  }: {
    event: { data: { projectId: string; userId: string; spaceId?: string | null } };
    step: { run: (id: string, fn: () => Promise<unknown>) => Promise<unknown> };
  }) => {
    const { projectId, userId, spaceId } = event.data;
    if (!projectId || !userId) throw new Error("Missing projectId/userId in mastery/updated event");

    const result = (await step.run("generate-recommendation", async () => {
      const { refreshRecommendationAfterTask } = await import("@/services/recommendation.service");
      return refreshRecommendationAfterTask({ projectId, userId, spaceId: spaceId ?? null, trigger: "mastery/updated", force: true });
    })) as { id: string; title: string } | null;

    return { projectId, recommendation: result };
  }
);

export const functions = [recommendationGenerateFunction as unknown as never];
