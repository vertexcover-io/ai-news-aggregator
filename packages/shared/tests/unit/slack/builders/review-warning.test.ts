import { describe, it, expect } from "vitest";
import { buildReviewWarningMessage } from "@shared/slack/builders/review-warning.js";

describe("buildReviewWarningMessage", () => {
  it("renders header with 'Review deadline approaching'", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-1",
      earliestChannel: "email-send",
      earliestTime: "09:00",
      minutesUntil: 30,
    });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header?.text.text).toBe("Review deadline approaching");
  });

  it("renders section with Email channel label and scheduled time and minutes", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-1",
      earliestChannel: "email-send",
      earliestTime: "09:00",
      minutesUntil: 30,
    });
    const section = blocks.find(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { type: string; text: string } } | undefined;
    expect(section?.text.text).toBe(
      "Email is scheduled for 09:00. Review is due in about 30 minutes.",
    );
  });

  it("renders section with LinkedIn channel label", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-2",
      earliestChannel: "linkedin-post",
      earliestTime: "10:30",
      minutesUntil: 15,
    });
    const section = blocks.find(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { type: string; text: string } } | undefined;
    expect(section?.text.text).toBe(
      "LinkedIn is scheduled for 10:30. Review is due in about 15 minutes.",
    );
  });

  it("renders section with Twitter channel label", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-3",
      earliestChannel: "twitter-post",
      earliestTime: "14:00",
      minutesUntil: 60,
    });
    const section = blocks.find(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { type: string; text: string } } | undefined;
    expect(section?.text.text).toBe(
      "Twitter is scheduled for 14:00. Review is due in about 60 minutes.",
    );
  });

  it("renders context with review link when publicArchiveBaseUrl is provided", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-7",
      earliestChannel: "email-send",
      earliestTime: "09:00",
      minutesUntil: 10,
      publicArchiveBaseUrl: "https://newsletter.example.com",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toContain(
      "https://newsletter.example.com/admin/review/run-7",
    );
    expect(context?.elements[0].text).toContain("run-7");
  });

  it("strips trailing slash from publicArchiveBaseUrl in review link", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-8",
      earliestChannel: "email-send",
      earliestTime: "09:00",
      minutesUntil: 5,
      publicArchiveBaseUrl: "https://newsletter.example.com/",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toContain(
      "https://newsletter.example.com/admin/review/run-8",
    );
    expect(context?.elements[0].text).not.toContain("//admin");
  });

  it("renders context with just runId when publicArchiveBaseUrl is not provided", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-9",
      earliestChannel: "twitter-post",
      earliestTime: "12:00",
      minutesUntil: 20,
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toBe("runId: run-9");
  });

  it("returns exactly 3 blocks", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-1",
      earliestChannel: "email-send",
      earliestTime: "09:00",
      minutesUntil: 30,
    });
    expect(blocks).toHaveLength(3);
  });
});
