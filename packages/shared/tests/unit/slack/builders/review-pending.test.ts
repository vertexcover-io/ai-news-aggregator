import { describe, it, expect } from "vitest";
import { buildReviewPendingMessage } from "@shared/slack/builders/review-pending.js";

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

describe("buildReviewPendingMessage", () => {
  it("embeds review URL in context block when publicArchiveBaseUrl is set", () => {
    const { blocks } = buildReviewPendingMessage({
      runId: "run-42",
      digestHeadline: null,
      publicArchiveBaseUrl: "https://news.example.com",
    });
    expect(contextText(blocks)).toBe(
      "<https://news.example.com/admin/review/run-42|Open review> · runId: run-42",
    );
  });

  it("falls back to runId text in context block when publicArchiveBaseUrl is undefined", () => {
    const { blocks } = buildReviewPendingMessage({
      runId: "run-99",
      digestHeadline: null,
    });
    expect(contextText(blocks)).toBe("runId: run-99");
  });

  it("falls back to runId text in context block when publicArchiveBaseUrl is empty string", () => {
    const { blocks } = buildReviewPendingMessage({
      runId: "run-77",
      digestHeadline: null,
      publicArchiveBaseUrl: "",
    });
    expect(contextText(blocks)).toBe("runId: run-77");
  });

  it("trims trailing slash from publicArchiveBaseUrl so URL has no double slash", () => {
    const { blocks } = buildReviewPendingMessage({
      runId: "run-1",
      digestHeadline: null,
      publicArchiveBaseUrl: "https://news.example.com/",
    });
    expect(contextText(blocks)).toBe(
      "<https://news.example.com/admin/review/run-1|Open review> · runId: run-1",
    );
  });

  it("uses default section text when digestHeadline is null", () => {
    const { blocks } = buildReviewPendingMessage({
      runId: "run-1",
      digestHeadline: null,
    });
    expect(sectionText(blocks)).toBe("A new newsletter run is ready.");
  });

  it("renders bold headline in section text when digestHeadline is non-null", () => {
    const { blocks } = buildReviewPendingMessage({
      runId: "run-2",
      digestHeadline: "AI agents dominate the news cycle",
    });
    expect(sectionText(blocks)).toBe("*AI agents dominate the news cycle*");
  });
});
