import { inngest } from "./client";
import { processMaterial } from "@/services/material.service";

export const materialProcessingFunction = (inngest as unknown as { createFunction: (...args: unknown[]) => unknown }).createFunction(
  { id: "material-processing", trigger: { event: "material/uploaded" } },
  async ({ event }: { event: { data: { materialId: string } } }) => {
    const { materialId } = event.data;
    await processMaterial(materialId);
    return { materialId, status: "processed" };
  }
);

export const functions = [materialProcessingFunction as unknown as never];
