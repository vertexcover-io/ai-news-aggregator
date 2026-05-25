import { describe, it, expect } from "vitest";
import {
  headerBlock,
  sectionMarkdown,
  contextMarkdown,
  statusSuffix,
  truncate,
  renderPermalink,
  archiveContextLine,
} from "@shared/slack/builders/_helpers.js";

describe("headerBlock", () => {
  it("returns a header block with plain_text and emoji true", () => {
    const block = headerBlock("Hello World");
    expect(block).toEqual({
      type: "header",
      text: { type: "plain_text", text: "Hello World", emoji: true },
    });
  });

  it("preserves the text string exactly", () => {
    const block = headerBlock("Test: special chars & more");
    expect((block.text as { text: string }).text).toBe("Test: special chars & more");
  });
});

describe("sectionMarkdown", () => {
  it("returns a section block with mrkdwn", () => {
    const block = sectionMarkdown("*bold* text");
    expect(block).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "*bold* text" },
    });
  });

  it("preserves markdown formatting in text", () => {
    const block = sectionMarkdown("<https://example.com|link>");
    expect((block.text as { text: string }).text).toBe("<https://example.com|link>");
  });
});

describe("contextMarkdown", () => {
  it("returns a context block with mrkdwn element", () => {
    const block = contextMarkdown("context text");
    expect(block).toEqual({
      type: "context",
      elements: [{ type: "mrkdwn", text: "context text" }],
    });
  });

  it("wraps text in a single-element array", () => {
    const block = contextMarkdown("runId: abc-123");
    expect((block.elements as { text: string }[])).toHaveLength(1);
    expect((block.elements as { text: string }[])[0].text).toBe("runId: abc-123");
  });
});

describe("statusSuffix", () => {
  it("returns empty string for completed status", () => {
    expect(statusSuffix("completed")).toBe("");
  });

  it("returns ' (failed)' for failed status", () => {
    expect(statusSuffix("failed")).toBe(" (failed)");
  });

  it("returns ' (partial)' for partial status", () => {
    expect(statusSuffix("partial")).toBe(" (partial)");
  });
});

describe("truncate", () => {
  it("returns the string unchanged when at or below the default max of 120", () => {
    const s = "a".repeat(120);
    expect(truncate(s)).toBe(s);
  });

  it("returns the string unchanged when shorter than the default max", () => {
    expect(truncate("short string")).toBe("short string");
  });

  it("truncates with ellipsis when over the default max of 120", () => {
    const s = "a".repeat(121);
    const result = truncate(s);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(120);
  });

  it("respects custom max parameter", () => {
    const result = truncate("hello world", 5);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("returns string unchanged when exactly at custom max", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("trims trailing whitespace before adding ellipsis", () => {
    // Space lands inside slice(0, 119): slice = 'a'.repeat(117) + '  '
    // trimEnd strips the two trailing spaces so the ellipsis is not preceded by whitespace
    const s = "a".repeat(117) + "  " + "x".repeat(4);
    const result = truncate(s);
    expect(result.endsWith("…")).toBe(true);
    expect(result).not.toContain(" …");
  });
});

describe("renderPermalink", () => {
  it("renders a LinkedIn URN as a Slack link to linkedin.com/feed/update", () => {
    const result = renderPermalink("urn:li:share:1234567890");
    expect(result).toBe("<https://www.linkedin.com/feed/update/urn:li:share:1234567890|view>");
  });

  it("renders an X (Twitter) URL as a Slack link with view label", () => {
    const result = renderPermalink("https://x.com/user/status/123456");
    expect(result).toBe("<https://x.com/user/status/123456|view>");
  });

  it("returns other strings unchanged (passthrough)", () => {
    const other = "https://example.com/some-post";
    expect(renderPermalink(other)).toBe(other);
  });

  it("returns a plain string unchanged when it does not match any pattern", () => {
    const plain = "some-plain-value";
    expect(renderPermalink(plain)).toBe(plain);
  });
});

describe("archiveContextLine", () => {
  it("returns a context block with archive link when publicArchiveBaseUrl is provided", () => {
    const block = archiveContextLine("run-abc", "https://newsletter.example.com");
    const elements = (block.elements as { text: string }[]);
    expect(elements[0].text).toContain("https://newsletter.example.com/archive/run-abc");
    expect(elements[0].text).toContain("run-abc");
  });

  it("strips trailing slash from publicArchiveBaseUrl", () => {
    const block = archiveContextLine("run-xyz", "https://newsletter.example.com/");
    const elements = (block.elements as { text: string }[]);
    expect(elements[0].text).toContain("https://newsletter.example.com/archive/run-xyz");
    expect(elements[0].text).not.toContain("//archive");
  });

  it("returns a context block with just runId when publicArchiveBaseUrl is undefined", () => {
    const block = archiveContextLine("run-abc", undefined);
    const elements = (block.elements as { text: string }[]);
    expect(elements[0].text).toBe("runId: run-abc");
  });

  it("returns a context block with just runId when publicArchiveBaseUrl is empty string", () => {
    const block = archiveContextLine("run-abc", "");
    const elements = (block.elements as { text: string }[]);
    expect(elements[0].text).toBe("runId: run-abc");
  });
});
