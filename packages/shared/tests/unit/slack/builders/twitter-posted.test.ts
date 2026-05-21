import { describe, it, expect } from "vitest";
import { buildTwitterPostedMessage } from "@shared/slack/builders/twitter-posted.js";

describe("buildTwitterPostedMessage", () => {
  // VS-8: Twitter posted builder
  it("renders header block with correct text", () => {
    const { blocks } = buildTwitterPostedMessage({
      runId: "run-1",
      headline: null,
      permalink: "https://x.com/user/status/123",
    });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header?.text.text).toBe("🟢 X (Twitter) posted");
  });

  it("renders digest headline section when provided", () => {
    const { blocks } = buildTwitterPostedMessage({
      runId: "run-1",
      headline: "Big AI week",
      permalink: "https://x.com/user/status/123",
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const headlineSection = sections.find((s) =>
      s.text.text.includes("Big AI week"),
    );
    expect(headlineSection?.text.text).toBe("*Big AI week*");
  });

  it("omits headline section when headline is null", () => {
    const { blocks } = buildTwitterPostedMessage({
      runId: "run-1",
      headline: null,
      permalink: "https://x.com/user/status/123",
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    // No section should look like a headline (short bold text)
    const headlineSection = sections.find((s) =>
      s.text.text.startsWith("*") && s.text.text.endsWith("*") && s.text.text.length < 60,
    );
    expect(headlineSection).toBeUndefined();
  });

  it("renders permalink as X URL in section block", () => {
    const { blocks } = buildTwitterPostedMessage({
      runId: "run-1",
      headline: null,
      permalink: "https://x.com/ai_news/status/9876543210",
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const permalinkSection = sections.find((s) =>
      s.text.text.includes("x.com"),
    );
    expect(permalinkSection).toBeDefined();
    expect(permalinkSection?.text.text).toContain(
      "<https://x.com/ai_news/status/9876543210|view>",
    );
  });

  it("renders archive context line with link when publicArchiveBaseUrl provided", () => {
    const { blocks } = buildTwitterPostedMessage({
      runId: "run-5",
      headline: null,
      permalink: "https://x.com/user/status/555",
      publicArchiveBaseUrl: "https://example.com",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toContain("https://example.com/archive/run-5");
  });

  it("renders runId-only context when no publicArchiveBaseUrl", () => {
    const { blocks } = buildTwitterPostedMessage({
      runId: "run-9",
      headline: null,
      permalink: "https://x.com/user/status/999",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toBe("runId: run-9");
  });
});
