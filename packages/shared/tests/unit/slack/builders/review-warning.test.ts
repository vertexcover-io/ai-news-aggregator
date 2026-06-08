import { describe, expect, it } from "vitest";

import { buildReviewWarningMessage } from "@shared/slack/builders/review-warning.js";

type Block = Record<string, unknown>;

function headerText(blocks: readonly unknown[]): string | undefined {
  const header = (blocks as Block[]).find((b) => b.type === "header") as
    | { type: string; text: { text: string } }
    | undefined;
  return header?.text.text;
}

function sectionTexts(blocks: readonly unknown[]): string[] {
  return (blocks as Block[])
    .filter((b) => b.type === "section")
    .map((b) => ((b as { type: string; text: { text: string } }).text?.text ?? ""));
}

function contextText(blocks: readonly unknown[]): string | undefined {
  const context = (blocks as Block[]).find((b) => b.type === "context") as
    | { type: string; elements: { text: string }[] }
    | undefined;
  return context?.elements[0]?.text;
}

describe("buildReviewWarningMessage", () => {
  it("header text is 'Review deadline approaching'", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-abc",
      earliestChannel: "email-send",
      earliestTime: "9:00 AM",
      minutesUntil: 30,
    });

    expect(headerText(blocks)).toBe("Review deadline approaching");
  });

  it("uses 'Email' label for email-send channel", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-1",
      earliestChannel: "email-send",
      earliestTime: "9:00 AM",
      minutesUntil: 15,
    });
    const texts = sectionTexts(blocks);

    expect(texts.some((t) => t.includes("Email"))).toBe(true);
  });

  it("uses 'LinkedIn' label for linkedin-post channel", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-2",
      earliestChannel: "linkedin-post",
      earliestTime: "10:00 AM",
      minutesUntil: 20,
    });
    const texts = sectionTexts(blocks);

    expect(texts.some((t) => t.includes("LinkedIn"))).toBe(true);
  });

  it("uses 'Twitter' label for twitter-post channel", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-3",
      earliestChannel: "twitter-post",
      earliestTime: "11:00 AM",
      minutesUntil: 10,
    });
    const texts = sectionTexts(blocks);

    expect(texts.some((t) => t.includes("Twitter"))).toBe(true);
  });

  it("includes minutesUntil in section text", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-4",
      earliestChannel: "email-send",
      earliestTime: "8:30 AM",
      minutesUntil: 45,
    });
    const texts = sectionTexts(blocks);

    expect(texts.some((t) => t.includes("45"))).toBe(true);
  });

  it("includes earliestTime in section text", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-5",
      earliestChannel: "email-send",
      earliestTime: "3:15 PM",
      minutesUntil: 60,
    });
    const texts = sectionTexts(blocks);

    expect(texts.some((t) => t.includes("3:15 PM"))).toBe(true);
  });

  it("context block contains a Markdown link when publicArchiveBaseUrl is set", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-xyz",
      earliestChannel: "email-send",
      earliestTime: "9:00 AM",
      minutesUntil: 30,
      publicArchiveBaseUrl: "https://newsletter.example.com",
    });
    const ctx = contextText(blocks);

    expect(ctx).toContain("https://newsletter.example.com/admin/review/run-xyz");
    expect(ctx).toContain("<https://newsletter.example.com/admin/review/run-xyz|Open review>");
  });

  it("context block strips trailing slash from publicArchiveBaseUrl before building link", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-trail",
      earliestChannel: "email-send",
      earliestTime: "9:00 AM",
      minutesUntil: 30,
      publicArchiveBaseUrl: "https://newsletter.example.com/",
    });
    const ctx = contextText(blocks);

    expect(ctx).not.toContain("//admin");
    expect(ctx).toContain("https://newsletter.example.com/admin/review/run-trail");
  });

  it("context block shows plain runId text when publicArchiveBaseUrl is absent", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-nope",
      earliestChannel: "email-send",
      earliestTime: "9:00 AM",
      minutesUntil: 30,
    });
    const ctx = contextText(blocks);

    expect(ctx).toContain("runId: run-nope");
    expect(ctx).not.toContain("<http");
  });

  it("context block shows plain runId text when publicArchiveBaseUrl is an empty string", () => {
    const { blocks } = buildReviewWarningMessage({
      runId: "run-empty",
      earliestChannel: "email-send",
      earliestTime: "9:00 AM",
      minutesUntil: 30,
      publicArchiveBaseUrl: "",
    });
    const ctx = contextText(blocks);

    expect(ctx).toContain("runId: run-empty");
    expect(ctx).not.toContain("<http");
  });
});
