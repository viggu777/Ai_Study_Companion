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
    if (result.updated.length > 0) {
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
          const { generateRecommendationForProject } = await import("@/services/recommendation.service");
          try {
            await generateRecommendationForProject({ projectId, userId, spaceId: spaceId ?? null });
          } catch (err) {
            console.error("Fallback recommendation generation failed:", err);
          }
        });
      }
    }

    return { quizId, updated: result.updated, skipped: result.skipped };
  }
);

export const functions = [masteryUpdateFunction as unknown as never];
