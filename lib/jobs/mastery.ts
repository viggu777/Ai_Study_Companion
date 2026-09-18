import { inngest } from "./client";

export const masteryUpdateFunction = (inngest as unknown as { createFunction: (...args: unknown[]) => unknown }).createFunction(
  { id: "mastery-update", trigger: { event: "quiz/completed" } },
  async ({ event, step }: { event: { data: { quizId: string; projectId: string; userId: string; spaceId?: string | null } }; step: { run: (id: string, fn: () => Promise<unknown>) => Promise<unknown> } }) => {
    const { quizId, projectId, userId, spaceId } = event.data;
    if (!quizId || !projectId || !userId) throw new Error("Missing quizId/projectId/userId in quiz/completed event");

    // Use step for retryability — whole mastery update as one step
    const result = (await step.run("update-mastery", async () => {
      const { updateMasteryForQuiz } = await import("@/services/mastery.service");
      return updateMasteryForQuiz({ quizId, projectId, userId, spaceId: spaceId ?? null });
    })) as { updated: unknown[]; skipped: string[] };

    // Chain to recommendation workflow per architecture §13: Quiz Completed → Evaluate → Update Mastery → Detect Weakness → Generate Recommendation
    // Always chain (even when mastery had nothing new / quiz was all-strong):
    // generation falls back to maintenance/stretch mode so an ACTIVE
    // recommendation still appears after the task instead of going quiet.
    try {
      await step.run("trigger-recommendation", async () => {
        const { inngest: client } = await import("./client");
        await (client as unknown as { send: (p: unknown) => Promise<void> }).send({
          name: "mastery/updated",
          data: { projectId, userId, spaceId: spaceId ?? null, quizId, updated: result.updated },
        });
      });
    } catch (e) {
      console.warn("Failed to send mastery/updated event, fallback direct generation:", e);
      await step.run("fallback-recommendation", async () => {
        const { refreshRecommendationAfterTask } = await import("@/services/recommendation.service");
        await refreshRecommendationAfterTask({ projectId, userId, spaceId: spaceId ?? null, trigger: "quiz/completed-fallback", force: true });
      });
    }

    return { quizId, updated: result.updated, skipped: result.skipped };
  }
);

export const functions = [masteryUpdateFunction as unknown as never];
