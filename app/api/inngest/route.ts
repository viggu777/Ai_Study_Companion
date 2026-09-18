import { serve } from "inngest/next";
import { inngest } from "@/lib/jobs/client";
import { functions as materialFunctions } from "@/lib/jobs/material";
import { functions as masteryFunctions } from "@/lib/jobs/mastery";
import { functions as recommendationFunctions } from "@/lib/jobs/recommendation";

// Material processing (pdf-parse + Gemini batches + concept extraction) can
// exceed the default serverless timeout — allow time on Vercel.
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ...(materialFunctions as unknown as never[]),
    ...(masteryFunctions as unknown as never[]),
    ...(recommendationFunctions as unknown as never[]),
  ] as unknown as Parameters<typeof serve>[0]["functions"],
});
