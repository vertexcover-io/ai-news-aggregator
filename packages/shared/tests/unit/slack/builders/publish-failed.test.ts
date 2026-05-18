import { describe, it, expect } from "vitest";
import { buildPublishFailedMessage } from "@shared/slack/builders/publish-failed.js";

function headerText(blocks: unknown[]): string {
  const header = (blocks as { type: string; text?: { text?: string } }[]).find(
    (b) => b.type === "header",
  );
  return header?.text?.text ?? "";
}

function sectionText(blocks: unknown[]): string {
  const sec = (blocks as { type: string; text?: { text?: string } }[]).find(
    (b) => b.type === "section",
  );
  return sec?.text?.text ?? "";
}

function contextText(blocks: unknown[]): string {
  const ctx = (blocks as { type: string; elements?: { text?: string }[] }[]).find(
    (b) => b.type === "context",
  );
  return ctx?.elements?.[0]?.text ?? "";
}

describe("buildPublishFailedMessage", () => {
  it("uses 'Email' in header and section for email-send channel", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: "run-1",
      channel: "email-send",
    });
    expect(headerText(blocks)).toContain("Email");
    expect(sectionText(blocks)).toContain("Email");
  });

  it("uses 'LinkedIn' in header and section for linkedin-post channel", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: "run-2",
      channel: "linkedin-post",
    });
    expect(headerText(blocks)).toContain("LinkedIn");
    expect(sectionText(blocks)).toContain("LinkedIn");
  });

  it("uses 'Twitter' in header and section for twitter-post channel", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: "run-3",
      channel: "twitter-post",
    });
    expect(headerText(blocks)).toContain("Twitter");
    expect(sectionText(blocks)).toContain("Twitter");
  });

  it("embeds review link in context block when publicArchiveBaseUrl is set", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: "run-4",
      channel: "email-send",
      publicArchiveBaseUrl: "https://news.example.com",
    });
    expect(contextText(blocks)).toBe(
      "<https://news.example.com/admin/review/run-4|Open review> · runId: run-4",
    );
  });

  it("falls back to runId text in context block when publicArchiveBaseUrl is undefined", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: "run-5",
      channel: "email-send",
    });
    expect(contextText(blocks)).toBe("runId: run-5");
  });
});
