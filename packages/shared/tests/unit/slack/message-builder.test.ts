import { describe, it, expect } from "vitest";
import { buildReviewedMessage } from "@shared/slack/message-builder.js";
import { buildReviewPendingMessage } from "@shared/slack/builders/review-pending.js";
import { buildPublishUnavailableMessage } from "@shared/slack/builders/publish-unavailable.js";
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
          {
            reason:
              "Resend error: Too many requests. You can only make 5 requests per second.",
            count: 32,
          },
          {
            reason:
              "Resend error: The vertexcover.io domain is not verified.",
            count: 6,
          },
        ],
      },
    });
    const distribution = sectionTexts(blocks).at(-1) ?? "";
    expect(distribution).toContain("Sent to 0/38 subscribers (38 failed).");
    expect(distribution).toContain(
      "◦ 32× Resend error: Too many requests. You can only make 5 requests per second.",
    );
    expect(distribution).toContain(
      "◦ 6× Resend error: The vertexcover.io domain is not verified.",
    );
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

  it("social posts: both posted with permalinks renders block with two view anchors", () => {
    const { blocks } = buildReviewedMessage({
      runId: "r",
      archive: { id: "r", digestHeadline: "h", rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: null,
      delivery: { attempted: 1, sent: 1, failed: 0 },
      socialResults: {
        linkedin: {
          status: "posted",
          permalink: "urn:li:share:7123456789",
        },
        twitter: {
          status: "posted",
          permalink: "https://x.com/foo/status/12345",
        },
      },
    });
    const sections = sectionTexts(blocks);
    const social = sections.find((s) => s.includes("🔗 Social posts"));
    expect(social).toBeDefined();
    expect(social).toContain("*🔗 Social posts*");
    expect(social).toContain(
      "🟢 LinkedIn: posted — <https://www.linkedin.com/feed/update/urn:li:share:7123456789|view>",
    );
    expect(social).toContain(
      "🟢 X: posted — <https://x.com/foo/status/12345|view>",
    );
  });

  it("social posts: one posted, one failed renders mixed emojis with reason", () => {
    const { blocks } = buildReviewedMessage({
      runId: "r",
      archive: { id: "r", digestHeadline: "h", rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: null,
      delivery: { attempted: 1, sent: 1, failed: 0 },
      socialResults: {
        linkedin: {
          status: "posted",
          permalink: "urn:li:share:abc",
        },
        twitter: { status: "failed", reason: "http_402" },
      },
    });
    const social = sectionTexts(blocks).find((s) =>
      s.includes("🔗 Social posts"),
    );
    expect(social).toBeDefined();
    expect(social).toContain("🟢 LinkedIn: posted —");
    expect(social).toContain("🔴 X: failed — http_402");
  });

  it("social posts: both skipped renders two ⚪ lines with reasons", () => {
    const { blocks } = buildReviewedMessage({
      runId: "r",
      archive: { id: "r", digestHeadline: "h", rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: null,
      delivery: { attempted: 1, sent: 1, failed: 0 },
      socialResults: {
        linkedin: { status: "skipped", reason: "already_posted" },
        twitter: { status: "skipped", reason: "disabled" },
      },
    });
    const social = sectionTexts(blocks).find((s) =>
      s.includes("🔗 Social posts"),
    );
    expect(social).toBeDefined();
    expect(social).toContain("⚪ LinkedIn: skipped — already_posted");
    expect(social).toContain("⚪ X: skipped — disabled");
  });

  it("social posts: posted with null permalink renders 'posted (duplicate detected)'", () => {
    const { blocks } = buildReviewedMessage({
      runId: "r",
      archive: { id: "r", digestHeadline: "h", rankedItems: [] },
      topRankedTitle: null,
      sourceTelemetry: null,
      delivery: { attempted: 1, sent: 1, failed: 0 },
      socialResults: {
        linkedin: { status: "posted", permalink: null },
      },
    });
    const social = sectionTexts(blocks).find((s) =>
      s.includes("🔗 Social posts"),
    );
    expect(social).toBeDefined();
    expect(social).toContain("🟢 LinkedIn: posted (duplicate detected)");
  });

  it("social posts: undefined socialResults omits the block (byte-identical to baseline)", () => {
    const args = {
      runId: "r-baseline",
      archive: {
        id: "r-baseline",
        digestHeadline: "headline",
        rankedItems: [],
      },
      topRankedTitle: null,
      sourceTelemetry: null,
      delivery: { attempted: 1, sent: 1, failed: 0 },
    } as const;
    const baseline = buildReviewedMessage(args);
    const withUndefined = buildReviewedMessage({
      ...args,
      socialResults: undefined,
    });
    expect(JSON.stringify(withUndefined.blocks)).toBe(
      JSON.stringify(baseline.blocks),
    );
    expect(
      sectionTexts(baseline.blocks).some((s) => s.includes("🔗 Social posts")),
    ).toBe(false);
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

describe("publish scheduling Slack messages", () => {
  it("ready-for-review includes the admin review link when a base URL is configured", () => {
    const { blocks } = buildReviewPendingMessage({
      runId: "run-123",
      digestHeadline: "Agents digest",
      publicArchiveBaseUrl: "https://news.example.com/",
    });

    expect(findHeader(blocks)).toBe("Newsletter ready for review");
    expect(contextTexts(blocks)[0]).toBe(
      "<https://news.example.com/admin/review/run-123|Open review> · runId: run-123",
    );
  });

  it("publish-unavailable explains that the latest failed run blocks fallback publishing", () => {
    const { blocks } = buildPublishUnavailableMessage({
      channel: "linkedin-post",
      reason: "latest_failed",
      runId: "run-456",
      publicArchiveBaseUrl: "https://news.example.com",
    });

    expect(findHeader(blocks)).toBe("LinkedIn was not posted");
    expect(sectionTexts(blocks)[0]).toContain("The latest pipeline run failed.");
    expect(contextTexts(blocks)[0]).toBe(
      "<https://news.example.com/admin/review/run-456|Open review> · runId: run-456",
    );
  });
});

describe("buildReviewPendingMessage — collector auth failures (REQ-008 / VS-5)", () => {
  it("labels a Twitter auth failure with the actionable admin-settings hint", () => {
    const telemetry: RunSourceTelemetry = {
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
          sourceType: "twitter",
          identifier: "list:123",
          displayName: "Twitter list",
          itemsFetched: 0,
          status: "failed",
          errors: ["missing or invalid cookies"],
          retries: 0,
          durationMs: 12,
        },
      ],
      totalItemsFetched: 12,
      totalErrors: 1,
    };

    const { blocks } = buildReviewPendingMessage({
      runId: "run-1",
      digestHeadline: "Today's digest",
      publicArchiveBaseUrl: "https://news.example.com",
      sourceTelemetry: telemetry,
    });

    const failureSection = sectionTexts(blocks).find((t) =>
      t.includes("Collector auth failures"),
    );
    expect(failureSection).toBeDefined();
    expect(failureSection).toContain(
      "twitter: skipped (missing cookies — set them at /admin/settings)",
    );
  });

  it("does not add an auth-failures section when all sources succeeded", () => {
    const { blocks } = buildReviewPendingMessage({
      runId: "run-2",
      digestHeadline: "Clean run",
      sourceTelemetry: baseTelemetry,
    });
    const failureSection = sectionTexts(blocks).find((t) =>
      t.includes("Collector auth failures"),
    );
    expect(failureSection).toBeUndefined();
  });

  it("ignores non-auth failures (e.g. rate-limit) in the auth-failures section", () => {
    const telemetry: RunSourceTelemetry = {
      sources: [
        {
          sourceType: "reddit",
          identifier: "r/ml",
          displayName: "r/ml",
          itemsFetched: 0,
          status: "failed",
          errors: ["rate limit exceeded"],
          retries: 0,
          durationMs: 50,
        },
      ],
      totalItemsFetched: 0,
      totalErrors: 1,
    };
    const { blocks } = buildReviewPendingMessage({
      runId: "run-3",
      digestHeadline: null,
      sourceTelemetry: telemetry,
    });
    const failureSection = sectionTexts(blocks).find((t) =>
      t.includes("Collector auth failures"),
    );
    expect(failureSection).toBeUndefined();
  });

  it("renders any auth-class failure across collectors (e.g. reddit 401)", () => {
    const telemetry: RunSourceTelemetry = {
      sources: [
        {
          sourceType: "reddit",
          identifier: "r/ml",
          displayName: "r/ml",
          itemsFetched: 0,
          status: "failed",
          errors: ["HTTP 401 unauthorized"],
          retries: 0,
          durationMs: 50,
        },
      ],
      totalItemsFetched: 0,
      totalErrors: 1,
    };
    const { blocks } = buildReviewPendingMessage({
      runId: "run-4",
      digestHeadline: null,
      sourceTelemetry: telemetry,
    });
    const failureSection = sectionTexts(blocks).find((t) =>
      t.includes("Collector auth failures"),
    );
    expect(failureSection).toContain("reddit: skipped (HTTP 401 unauthorized)");
  });
});
