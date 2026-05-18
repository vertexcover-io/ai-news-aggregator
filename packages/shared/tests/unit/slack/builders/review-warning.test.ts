import { describe, it, expect } from "vitest";
import { buildReviewWarningMessage } from "@shared/slack/builders/review-warning.js";

function contextText(blocks: unknown[]): string {
  const ctx = (blocks as { type: string; elements?: { text?: string }[] }[]).find(
    (b) => b.type === "context",
  );
  return ctx?.elements?.[0]?.text ?? "";
}

function sectionText(blocks: unknown[]): string {
  const sec = (blocks as { type: string; text?: { text?: string } }[]).find(
    (b) => b.type === "section",
  );
  return sec?.text?.text ?? "";
}

describe("buildReviewWarningMessage", () => {
  it("embeds review URL in context block when publicArchiveBaseUrl is set", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-10",
      earliestChannel: "email-send",
      earliestTime: "08:00",
      minutesUntil: 30,
      publicArchiveBaseUrl: "https://news.example.com",
    });
    expect(contextText(blocks)).toBe(
      "<https://news.example.com/admin/review/run-10|Open review> · runId: run-10",
    );
  });

  it("falls back to runId text in context block when publicArchiveBaseUrl is undefined", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-11",
      earliestChannel: "email-send",
      earliestTime: "08:00",
      minutesUntil: 15,
    });
    expect(contextText(blocks)).toBe("runId: run-11");
  });

  it("uses 'Email' label for email-send channel", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-20",
      earliestChannel: "email-send",
      earliestTime: "09:00",
      minutesUntil: 45,
    });
    expect(sectionText(blocks)).toContain("Email");
  });

  it("uses 'LinkedIn' label for linkedin-post channel", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-21",
      earliestChannel: "linkedin-post",
      earliestTime: "10:00",
      minutesUntil: 20,
    });
    expect(sectionText(blocks)).toContain("LinkedIn");
  });

  it("uses 'Twitter' label for twitter-post channel", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-22",
      earliestChannel: "twitter-post",
      earliestTime: "11:00",
      minutesUntil: 10,
    });
    expect(sectionText(blocks)).toContain("Twitter");
  });

  it("interpolates minutesUntil and earliestTime into section text", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-30",
      earliestChannel: "email-send",
      earliestTime: "14:30",
      minutesUntil: 25,
    });
    const text = sectionText(blocks);
    expect(text).toContain("14:30");
    expect(text).toContain("25");
  });
});
