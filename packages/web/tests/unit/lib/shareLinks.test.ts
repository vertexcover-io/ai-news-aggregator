import { describe, expect, it } from "vitest";
import {
  buildLinkedInShareUrl,
  buildXShareUrl,
  truncateForX,
} from "../../../src/lib/shareLinks";

describe("buildLinkedInShareUrl", () => {
  it("encodes the archive URL into the share-offsite URL (REQ-003)", () => {
    expect(buildLinkedInShareUrl("https://example.com/archive/abc")).toBe(
      "https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fexample.com%2Farchive%2Fabc",
    );
  });

  it("does NOT include text/title/summary query params", () => {
    const url = buildLinkedInShareUrl("https://example.com/archive/abc");
    expect(url).not.toContain("text=");
    expect(url).not.toContain("title=");
    expect(url).not.toContain("summary=");
  });
});

describe("buildXShareUrl", () => {
  it("encodes text and url with %20 spaces (REQ-004)", () => {
    expect(
      buildXShareUrl("https://example.com/archive/abc", "AI news - May 6, 2026"),
    ).toBe(
      "https://twitter.com/intent/tweet?text=AI%20news%20-%20May%206%2C%202026&url=https%3A%2F%2Fexample.com%2Farchive%2Fabc",
    );
  });

  it("calls truncateForX(longText, 24) so the resulting text is bounded", () => {
    const longText = "x".repeat(300);
    const url = buildXShareUrl("https://example.com/a", longText);
    const m = /text=([^&]+)/.exec(url);
    expect(m).not.toBeNull();
    if (m === null) throw new Error("text param missing");
    const decoded = decodeURIComponent(m[1]);
    // Budget = 280 - 24 = 256 ; 300 > 256 ⇒ slice(0, 255) + "…"
    expect(decoded.length).toBe(256);
    expect(decoded.endsWith("…")).toBe(true);
  });
});

describe("truncateForX", () => {
  it("returns input unchanged when well within budget", () => {
    expect(truncateForX("AI news - May 6, 2026", 24)).toBe("AI news - May 6, 2026");
  });

  it("returns input unchanged at the boundary (length === budget)", () => {
    const s = "a".repeat(256);
    expect(truncateForX(s, 24)).toBe(s);
  });

  it("returns slice(0, budget-1) + ellipsis when over budget", () => {
    const result = truncateForX("a".repeat(257), 24);
    expect(result).toBe("a".repeat(255) + "…");
    expect(result.length).toBe(256);
  });

  it("returns empty string for empty input", () => {
    expect(truncateForX("", 24)).toBe("");
  });
});
