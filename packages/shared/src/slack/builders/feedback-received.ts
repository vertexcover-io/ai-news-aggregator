import type { FeedbackRating } from "../../db/schema.js";
import { sectionMarkdown } from "./_helpers.js";

const RATING_LABEL: Record<FeedbackRating, string> = {
  love: "👍 Genuinely useful, keep it coming",
  meh: "😐 It's fine, skims it",
  nah: "👎 Not really for me",
};

export function buildFeedbackReceivedMessage(input: {
  readonly email: string;
  readonly rating: FeedbackRating;
}): { blocks: unknown[] } {
  const text = `:speech_balloon: AgentLoop feedback from ${input.email}: ${RATING_LABEL[input.rating]}`;
  return { blocks: [sectionMarkdown(text)] };
}
