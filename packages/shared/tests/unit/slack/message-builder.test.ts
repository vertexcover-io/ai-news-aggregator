import { describe, it, expect } from "vitest";
import { buildReviewedMessage } from "@shared/slack/message-builder.js";
import type { RunSourceTelemetry } from "@shared/types/run.js";

const baseTelemetry: RunSourceTelemetry = {
  sources: [
    {
      sourceType: "hn",
      identifier: "hn",
      displayName: "Hacker News",
      itemsFetched: 12,
      status: "completed",
      errors: [],
      retries: 0,
      durationMs: 1500,
    },
    {
      sourceType: "reddit",
      identifier: "r/MachineLearning",
      displayName: "r/MachineLearning",
      itemsFetched: 8,
      status: "completed",
      errors: [],
      retries: 0,
      durationMs: 2100,
    },
    {
      sourceType: "twitter",
      identifier: "list:123",
      displayName: "Twitter list",
      itemsFetched: 4,
      status: "completed",
      errors: [],
      retries: 0,
      durationMs: 800,
    },
  ],
  totalItemsFetched: 24,
  totalErrors: 0,
};

function findHeader(blocks: unknown[]): string {
  const header = (blocks as { type: string; text?: { text?: string } }[]).find(
    (b) => b.type === "header",
  );
  return header?.text?.text ?? "";
}

function sectionTexts(blocks: unknown[]): string[] {
  return (blocks as { type: string; text?: { text?: string } }[])
    .filter((b) => b.type === "section")
    .map((b) => b.text?.text ?? "");
}

function contextTexts(blocks: unknown[]): string[] {
  return (
    blocks as { type: string; elements?: { text?: string }[] }[]
  )
    .filter((b) => b.type === "context")
    .flatMap((b) => (b.elements ?? []).map((e) => e.text ?? ""));
}

describe("buildReviewedMessage", () => {
  it("happy path: full telemetry, manual trigger, with archive base url", () => {
    const { blocks } = buildReviewedMessage({
      runId: "run-123",
      trigger: "manual",
      archive: {
        id: "run-123",
        digestHeadline: "AI agents take over the weekend",
        rankedItems: [{ rawItemId: 1 }, { rawItemId: 2 }],
      },
      topRankedTitle: null,
      sourceTelemetry: baseTelemetry,
      subscriberCount: 5,
      publicArchiveBaseUrl: "https://news.example.com",
    });

    expect(findHeader(blocks)).toBe("🟢 Newsletter Reviewed (manual)");
    const sections = sectionTexts(blocks);
    expect(sections[0]).toBe("*AI agents take over the weekend*");
    expect(sections[1]).toContain("*📊 Sources*");
    expect(sections[1]).toContain("• Hacker News: 12 items");
    expect(sections[1]).toContain("_Total: 24 items fetched_");
    expect(sections.some((s) => s.includes("⚠️ Errors"))).toBe(false);
    expect(sections.at(-1)).toBe(
      "*📬 Distribution*\nWill send to 5 subscribers.",
    );
    expect(contextTexts(blocks)[0]).toBe(
      "🔗 <https://news.example.com/archive/run-123|View archive> · runId: run-123",
    );
  });

  it("includes Errors section when a source failed", () => {
    const telemetry: RunSourceTelemetry = {
      ...baseTelemetry,
      sources: [
        ...baseTelemetry.sources,
        {
          sourceType: "blog",
          identifier: "openai",
          displayName: "OpenAI Blog",
          itemsFetched: 0,
          status: "failed",
          errors: ["timeout after 30s"],
          retries: 2,
          durationMs: 30000,
        },
      ],
      totalErrors: 1,
    };
    const { blocks } = buildReviewedMessage({
      runId: "run-1",
      trigger: "manual",
      archive: { id: "run-1", digestHeadline: "X", rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: telemetry,
      subscriberCount: 2,
    });
    const sections = sectionTexts(blocks);
    const errorsSection = sections.find((s) => s.includes("⚠️ Errors"));
    expect(errorsSection).toBeDefined();
    expect(errorsSection).toContain("*⚠️ Errors (1)*");
    expect(errorsSection).toContain(
      "• OpenAI Blog: timeout after 30s (2 retries) — failed",
    );
    expect(sections.find((s) => s.includes("📊 Sources"))).toContain(
      "• OpenAI Blog: 0 items (failed)",
    );
  });

  it("legacy archive: telemetry null produces 'Telemetry unavailable' and no Errors", () => {
    const { blocks } = buildReviewedMessage({
      runId: "run-legacy",
      trigger: "manual",
      archive: {
        id: "run-legacy",
        digestHeadline: "Legacy",
        rankedItems: [],
      },
      topRankedTitle: null,
      sourceTelemetry: null,
      subscriberCount: 1,
    });
    const sections = sectionTexts(blocks);
    expect(
      sections.some((s) => s === "Telemetry unavailable (legacy run)"),
    ).toBe(true);
    expect(sections.some((s) => s.includes("⚠️ Errors"))).toBe(false);
    expect(sections.some((s) => s.includes("📊 Sources"))).toBe(false);
    expect(sections.at(-1)).toBe(
      "*📬 Distribution*\nWill send to 1 subscriber.",
    );
  });

  it("omits headline section when both digestHeadline and topRankedTitle are missing", () => {
    const { blocks } = buildReviewedMessage({
      runId: "run-x",
      trigger: "manual",
      archive: { id: "run-x", digestHeadline: null, rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: null,
      subscriberCount: 0,
    });
    const sections = sectionTexts(blocks);
    expect(sections.some((s) => /^\*[^*]+\*$/.test(s))).toBe(false);
  });

  it("uses topRankedTitle as fallback when digestHeadline is null", () => {
    const { blocks } = buildReviewedMessage({
      runId: "run-x",
      trigger: "manual",
      archive: { id: "run-x", digestHeadline: null, rankedItems: [] },
      topRankedTitle: "Fallback title",
      sourceTelemetry: null,
      subscriberCount: 0,
    });
    expect(sectionTexts(blocks)).toContain("*Fallback title*");
  });

  it("reflects auto-review trigger in header", () => {
    const { blocks } = buildReviewedMessage({
      runId: "r",
      trigger: "auto-review",
      archive: { id: "r", digestHeadline: "h", rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: null,
      subscriberCount: 0,
    });
    expect(findHeader(blocks)).toBe("🟢 Newsletter Reviewed (auto-review)");
  });

  it("falls back to runId-only context when no public archive base url", () => {
    const { blocks } = buildReviewedMessage({
      runId: "r-99",
      trigger: "manual",
      archive: { id: "r-99", digestHeadline: "h", rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: null,
      subscriberCount: 1,
    });
    expect(contextTexts(blocks)[0]).toBe("runId: r-99");
  });
});
