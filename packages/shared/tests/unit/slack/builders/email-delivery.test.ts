import { describe, it, expect } from "vitest";
import { buildEmailDeliveryMessage } from "@shared/slack/builders/email-delivery.js";
import type { DeliveryCounts } from "@shared/slack/types.js";

describe("buildEmailDeliveryMessage", () => {
  // VS-4: email delivery builder
  it("renders header block with correct text", () => {
    const delivery: DeliveryCounts = {
      attempted: 5,
      sent: 5,
      failed: 0,
    };
    const { blocks } = buildEmailDeliveryMessage({
      runId: "run-1",
      headline: null,
      delivery,
    });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header?.text.text).toBe("📬 Newsletter emailed");
  });

  it("renders digest headline section when provided", () => {
    const delivery: DeliveryCounts = {
      attempted: 5,
      sent: 5,
      failed: 0,
    };
    const { blocks } = buildEmailDeliveryMessage({
      runId: "run-1",
      headline: "Today in AI",
      delivery,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const headlineSection = sections.find((s) => s.text.text.includes("Today in AI"));
    expect(headlineSection?.text.text).toBe("*Today in AI*");
  });

  it("omits headline section when headline is null", () => {
    const delivery: DeliveryCounts = {
      attempted: 5,
      sent: 5,
      failed: 0,
    };
    const { blocks } = buildEmailDeliveryMessage({
      runId: "run-1",
      headline: null,
      delivery,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    // No section should start with * and end with * (a headline) — only distribution and context expected
    const headlineLikeSection = sections.find((s) =>
      s.text.text.startsWith("*") && s.text.text.endsWith("*") && s.text.text.length < 60,
    );
    expect(headlineLikeSection).toBeUndefined();
  });

  it("renders 'Sent to X/Y subscribers (Z failed)' when there are failures", () => {
    const delivery: DeliveryCounts = {
      attempted: 5,
      sent: 4,
      failed: 1,
      failureReasons: [{ reason: "bounce", count: 1 }],
    };
    const { blocks } = buildEmailDeliveryMessage({
      runId: "run-1",
      headline: null,
      delivery,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const distSection = sections.find((s) =>
      s.text.text.includes("4/5 subscribers"),
    );
    expect(distSection).toBeDefined();
    expect(distSection?.text.text).toContain("1 failed");
  });

  it("renders top-3 failure reasons", () => {
    const delivery: DeliveryCounts = {
      attempted: 10,
      sent: 7,
      failed: 3,
      failureReasons: [
        { reason: "bounce", count: 2 },
        { reason: "spam", count: 1 },
        { reason: "invalid_email", count: 1 },
        { reason: "other", count: 1 },
      ],
    };
    const { blocks } = buildEmailDeliveryMessage({
      runId: "run-1",
      headline: null,
      delivery,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const distSection = sections.find((s) =>
      s.text.text.includes("subscribers"),
    );
    expect(distSection?.text.text).toContain("bounce");
    expect(distSection?.text.text).toContain("spam");
    expect(distSection?.text.text).toContain("invalid_email");
  });

  it("renders clean distribution when all sent", () => {
    const delivery: DeliveryCounts = {
      attempted: 3,
      sent: 3,
      failed: 0,
    };
    const { blocks } = buildEmailDeliveryMessage({
      runId: "run-1",
      headline: null,
      delivery,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const distSection = sections.find((s) =>
      s.text.text.includes("subscriber"),
    );
    expect(distSection).toBeDefined();
    expect(distSection?.text.text).toContain("Sent to 3");
  });

  it("renders archive context line with link when publicArchiveBaseUrl provided", () => {
    const delivery: DeliveryCounts = {
      attempted: 3,
      sent: 3,
      failed: 0,
    };
    const { blocks } = buildEmailDeliveryMessage({
      runId: "run-7",
      headline: null,
      delivery,
      publicArchiveBaseUrl: "https://newsletter.example.com",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toContain("https://newsletter.example.com/archive/run-7");
  });
});
