import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "ai-study-companion",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
