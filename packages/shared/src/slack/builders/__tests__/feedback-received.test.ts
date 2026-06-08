import { describe, expect, it } from "vitest";
import type { FeedbackRating } from "@newsletter/shared/db";
import { buildFeedbackReceivedMessage } from "../feedback-received.js";

describe("buildFeedbackReceivedMessage", () => {
  it.each<[FeedbackRating, string]>([
    ["love", "👍"],
    ["meh", "😐"],
    ["nah", "👎"],
  ])("renders the %s rating with its emoji and the subscriber email", (rating, emoji) => {
    const { blocks } = buildFeedbackReceivedMessage({
      email: "reader@example.com",
      rating,
    });

    expect(blocks).toHaveLength(1);
    const text = JSON.stringify(blocks);
    expect(text).toContain("reader@example.com");
    expect(text).toContain(emoji);
  });
});
