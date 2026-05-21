import { describe, it, expect } from "vitest";
import { buildLinkedinPostedMessage } from "@shared/slack/builders/linkedin-posted.js";

describe("buildLinkedinPostedMessage", () => {
  // VS-6: LinkedIn posted builder
  it("renders header block with correct text", () => {
    const { blocks } = buildLinkedinPostedMessage({
      runId: "run-1",
      headline: null,
      permalink: "urn:li:share:123",
    });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header?.text.text).toBe("🟢 LinkedIn posted");
  });

  it("renders digest headline section when provided", () => {
    const { blocks } = buildLinkedinPostedMessage({
      runId: "run-1",
      headline: "LLMs Take Over Enterprise",
      permalink: "urn:li:share:123",
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const headlineSection = sections.find((s) =>
      s.text.text.includes("LLMs Take Over Enterprise"),
    );
    expect(headlineSection?.text.text).toBe("*LLMs Take Over Enterprise*");
  });

  it("omits headline section when headline is null", () => {
    const { blocks } = buildLinkedinPostedMessage({
      runId: "run-1",
      headline: null,
      permalink: "urn:li:share:123",
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

  it("renders permalink as LinkedIn URL in section block", () => {
    const { blocks } = buildLinkedinPostedMessage({
      runId: "run-1",
      headline: null,
      permalink: "urn:li:share:7777",
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const permalinkSection = sections.find((s) =>
      s.text.text.includes("linkedin.com"),
    );
    expect(permalinkSection).toBeDefined();
    expect(permalinkSection?.text.text).toContain(
      "<https://www.linkedin.com/feed/update/urn:li:share:7777|view>",
    );
  });

  it("renders archive context line with link when publicArchiveBaseUrl provided", () => {
    const { blocks } = buildLinkedinPostedMessage({
      runId: "run-5",
      headline: null,
      permalink: "urn:li:share:555",
      publicArchiveBaseUrl: "https://example.com",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toContain("https://example.com/archive/run-5");
    expect(context?.elements[0].text).toContain("run-5");
  });

  it("renders runId-only context when no publicArchiveBaseUrl", () => {
    const { blocks } = buildLinkedinPostedMessage({
      runId: "run-9",
      headline: null,
      permalink: "urn:li:share:999",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toBe("runId: run-9");
  });
});
