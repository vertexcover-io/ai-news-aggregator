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
  it("happy path: full telemetry, all sent, with archive base url", () => {
    const { blocks } = buildReviewedMessage({
      runId: "run-123",
      archive: {
        id: "run-123",
        digestHeadline: "AI agents take over the weekend",
        rankedItems: [{ rawItemId: 1 }, { rawItemId: 2 }],
      },
      topRankedTitle: null,
      sourceTelemetry: baseTelemetry,
      delivery: { attempted: 5, sent: 5, failed: 0 },
      publicArchiveBaseUrl: "https://news.example.com",
    });

    expect(findHeader(blocks)).toBe("🟢 Newsletter Sent");
    const sections = sectionTexts(blocks);
    expect(sections[0]).toBe("*AI agents take over the weekend*");
    expect(sections[1]).toContain("*📊 Sources*");
    expect(sections[1]).toContain("• Hacker News: 12 items");
    expect(sections[1]).toContain("_Total: 24 items fetched_");
    // Errors section is ALWAYS present, with "No collection errors" when zero.
    const errorsSection = sections.find((s) => s.includes("⚠️ Errors"));
    expect(errorsSection).toBeDefined();
    expect(errorsSection).toContain("*⚠️ Errors*");
    expect(errorsSection).toContain("• No collection errors");
    expect(sections.at(-1)).toBe(
      "*📬 Distribution*\nSent to 5 subscribers.",
    );
    expect(contextTexts(blocks)[0]).toBe(
      "🔗 <https://news.example.com/archive/run-123|View archive> · runId: run-123",
    );
  });

  it("Errors section lists failed sources when present", () => {
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
      archive: { id: "run-1", digestHeadline: "X", rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: telemetry,
      delivery: { attempted: 2, sent: 2, failed: 0 },
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

  it("legacy archive: telemetry null produces 'Telemetry unavailable' and no Errors section", () => {
    const { blocks } = buildReviewedMessage({
      runId: "run-legacy",
      archive: {
        id: "run-legacy",
        digestHeadline: "Legacy",
        rankedItems: [],
      },
      topRankedTitle: null,
      sourceTelemetry: null,
      delivery: { attempted: 1, sent: 1, failed: 0 },
    });
    const sections = sectionTexts(blocks);
    expect(
      sections.some((s) => s === "Telemetry unavailable (legacy run)"),
    ).toBe(true);
    expect(sections.some((s) => s.includes("⚠️ Errors"))).toBe(false);
    expect(sections.some((s) => s.includes("📊 Sources"))).toBe(false);
    expect(sections.at(-1)).toBe(
      "*📬 Distribution*\nSent to 1 subscriber.",
    );
  });

  it("distribution shows partial when some delivery failed", () => {
    const { blocks } = buildReviewedMessage({
      runId: "r",
      archive: { id: "r", digestHeadline: "h", rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: null,
      delivery: { attempted: 10, sent: 8, failed: 2 },
    });
    const sections = sectionTexts(blocks);
    expect(sections.at(-1)).toBe(
      "*📬 Distribution*\nSent to 8/10 subscribers (2 failed).",
    );
  });

  it("distribution lists top failure reasons strategically (no log dumps)", () => {
    const { blocks } = buildReviewedMessage({
      runId: "r",
      archive: { id: "r", digestHeadline: "h", rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: null,
      delivery: {
        attempted: 38,
        sent: 0,
        failed: 38,
        failureReasons: [
          { reason: "rate limit", count: 32 },
          { reason: "unverified sender domain", count: 6 },
        ],
      },
    });
    const distribution = sectionTexts(blocks).at(-1) ?? "";
    expect(distribution).toContain("Sent to 0/38 subscribers (38 failed).");
    expect(distribution).toContain("◦ 32× rate limit");
    expect(distribution).toContain("◦ 6× unverified sender domain");
  });

  it("distribution buckets reasons beyond top-3 into 'other'", () => {
    const { blocks } = buildReviewedMessage({
      runId: "r",
      archive: { id: "r", digestHeadline: "h", rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: null,
      delivery: {
        attempted: 50,
        sent: 0,
        failed: 50,
        failureReasons: [
          { reason: "rate limit", count: 20 },
          { reason: "unverified sender domain", count: 15 },
          { reason: "recipient rejected", count: 10 },
          { reason: "network timeout", count: 3 },
          { reason: "auth/permission denied", count: 2 },
        ],
      },
    });
    const distribution = sectionTexts(blocks).at(-1) ?? "";
    expect(distribution).toContain("◦ 20× rate limit");
    expect(distribution).toContain("◦ 15× unverified sender domain");
    expect(distribution).toContain("◦ 10× recipient rejected");
    expect(distribution).toContain("◦ 5× other (2 more reasons)");
  });

  it("collection error messages are truncated at ~120 chars", () => {
    const longErr = "A".repeat(300);
    const telemetry: RunSourceTelemetry = {
      sources: [
        {
          sourceType: "blog",
          identifier: "x",
          displayName: "X Blog",
          itemsFetched: 0,
          status: "failed",
          errors: [longErr],
          retries: 1,
          durationMs: 100,
        },
      ],
      totalItemsFetched: 0,
      totalErrors: 1,
    };
    const { blocks } = buildReviewedMessage({
      runId: "r",
      archive: { id: "r", digestHeadline: "h", rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: telemetry,
      delivery: { attempted: 1, sent: 1, failed: 0 },
    });
    const errorsSection = sectionTexts(blocks).find((s) => s.includes("⚠️ Errors"));
    expect(errorsSection).toBeDefined();
    // The displayed reason must be ≤ 120 chars and end with an ellipsis.
    const match = errorsSection?.match(/• X Blog: (.+?) \(\d+ retries\)/);
    expect(match).not.toBeNull();
    const reason = match?.[1] ?? "";
    expect(reason.length).toBeLessThanOrEqual(120);
    expect(reason.endsWith("…")).toBe(true);
  });

  it("omits headline section when both digestHeadline and topRankedTitle are missing", () => {
    const { blocks } = buildReviewedMessage({
      runId: "run-x",
      archive: { id: "run-x", digestHeadline: null, rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: null,
      delivery: { attempted: 0, sent: 0, failed: 0 },
    });
    const sections = sectionTexts(blocks);
    expect(sections.some((s) => /^\*[^*]+\*$/.test(s))).toBe(false);
  });

  it("uses topRankedTitle as fallback when digestHeadline is null", () => {
    const { blocks } = buildReviewedMessage({
      runId: "run-x",
      archive: { id: "run-x", digestHeadline: null, rankedItems: [] },
      topRankedTitle: "Fallback title",
      sourceTelemetry: null,
      delivery: { attempted: 0, sent: 0, failed: 0 },
    });
    expect(sectionTexts(blocks)).toContain("*Fallback title*");
  });

  it("falls back to runId-only context when no public archive base url", () => {
    const { blocks } = buildReviewedMessage({
      runId: "r-99",
      archive: { id: "r-99", digestHeadline: "h", rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: null,
      delivery: { attempted: 1, sent: 1, failed: 0 },
    });
    expect(contextTexts(blocks)[0]).toBe("runId: r-99");
  });
});
