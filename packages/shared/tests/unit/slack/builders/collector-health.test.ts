import { describe, it, expect } from "vitest";
import {
  buildCollectorHealthMessage,
  type CollectorHealthFailure,
} from "@shared/slack/builders/collector-health.js";

describe("buildCollectorHealthMessage", () => {
  // REQ-014: one consolidated Slack message per health-check run

  it("header carries the trigger tag for scheduled trigger (two failures)", () => {
    const failures: CollectorHealthFailure[] = [
      { collector: "hn", reason: "connection refused" },
      { collector: "reddit", reason: "RSS feed returned 429" },
    ];
    const { blocks } = buildCollectorHealthMessage({ failures, trigger: "scheduled" });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header).toBeDefined();
    expect(header?.text.text).toBe("🔴 Collector health check failed (scheduled)");
  });

  it("header carries the trigger tag for manual trigger", () => {
    const failures: CollectorHealthFailure[] = [
      { collector: "twitter", reason: "auth failed" },
    ];
    const { blocks } = buildCollectorHealthMessage({ failures, trigger: "manual" });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header?.text.text).toBe("🔴 Collector health check failed (manual)");
  });

  it("body has one bullet per failed collector with its reason (two failures)", () => {
    const failures: CollectorHealthFailure[] = [
      { collector: "hn", reason: "connection refused" },
      { collector: "reddit", reason: "RSS feed returned 429" },
    ];
    const { blocks } = buildCollectorHealthMessage({ failures, trigger: "scheduled" });
    const section = blocks.find(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } } | undefined;
    expect(section).toBeDefined();
    expect(section?.text.text).toContain("• hn: connection refused");
    expect(section?.text.text).toContain("• reddit: RSS feed returned 429");
  });

  it("single failure renders exactly one bullet", () => {
    const failures: CollectorHealthFailure[] = [
      { collector: "web_search", reason: "TAVILY_API_KEY not configured" },
    ];
    const { blocks } = buildCollectorHealthMessage({ failures, trigger: "manual" });
    const section = blocks.find(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } } | undefined;
    expect(section).toBeDefined();
    const bullets = (section?.text.text ?? "").split("\n").filter((l) => l.startsWith("•"));
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toBe("• web_search: TAVILY_API_KEY not configured");
  });

  it("long reason is truncated to 120 chars", () => {
    const longReason = "x".repeat(200);
    const failures: CollectorHealthFailure[] = [
      { collector: "blog", reason: longReason },
    ];
    const { blocks } = buildCollectorHealthMessage({ failures, trigger: "scheduled" });
    const section = blocks.find(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } } | undefined;
    // truncate(200-char string) → 119 chars + "…" = 120 chars in the reason portion
    const line = (section?.text.text ?? "").split("\n").find((l) => l.startsWith("• blog:"));
    expect(line).toBeDefined();
    // reason part after "• blog: "
    const reasonPart = (line ?? "").slice("• blog: ".length);
    expect(reasonPart.length).toBeLessThanOrEqual(120);
    expect(reasonPart.endsWith("…")).toBe(true);
  });

  it("produces exactly one message (one blocks array, no archive context line)", () => {
    const failures: CollectorHealthFailure[] = [
      { collector: "hn", reason: "err1" },
      { collector: "reddit", reason: "err2" },
      { collector: "twitter", reason: "err3" },
    ];
    const { blocks } = buildCollectorHealthMessage({ failures, trigger: "scheduled" });
    // Only header + section — no context block
    const types = blocks.map((b) => (b as { type: string }).type);
    expect(types).toEqual(["header", "section"]);
  });
});
