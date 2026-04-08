import { describe, it, expect } from "vitest";
import {
  canonicalizeUrl,
  dedupCandidates,
  type DedupCandidate,
} from "@pipeline/processors/dedup.js";

describe("canonicalizeUrl", () => {
  it("lowercases host, strips trailing slash, drops tracking params and fragment", () => {
    // REQ-050
    expect(
      canonicalizeUrl(
        "https://Example.com/path/?utm_source=rss&ref=newsletter#section",
      ),
    ).toBe("https://example.com/path");
  });

  it("returns already-canonical URL unchanged", () => {
    expect(canonicalizeUrl("https://example.com/path")).toBe(
      "https://example.com/path",
    );
  });

  it("preserves the root slash", () => {
    expect(canonicalizeUrl("https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  it("keeps non-tracking query params and drops tracking params", () => {
    expect(
      canonicalizeUrl("https://example.com/a/b?utm_campaign=x&keep=1"),
    ).toBe("https://example.com/a/b?keep=1");
  });

  it("returns a protocol-less string unchanged (EDGE-014)", () => {
    expect(canonicalizeUrl("example.com/path")).toBe("example.com/path");
  });

  it("removes a fragment", () => {
    expect(canonicalizeUrl("https://example.com/x#frag")).toBe(
      "https://example.com/x",
    );
  });
});

describe("dedupCandidates", () => {
  const make = (
    id: number,
    url: string,
    points: number,
    commentCount: number,
  ): DedupCandidate => ({
    id,
    url,
    engagement: { points, commentCount },
  });

  it("keeps the highest engagement representative for duplicates (REQ-051)", () => {
    const items: DedupCandidate[] = [
      make(1, "https://example.com/post", 10, 0),
      make(2, "https://example.com/post?utm_source=rss", 50, 0),
      make(3, "https://example.com/post/#x", 5, 0),
    ];
    const result = dedupCandidates(items);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(2);
  });

  it("preserves original insertion order of survivors (REQ-052)", () => {
    const a = make(1, "https://example.com/a", 5, 0);
    const b = make(2, "https://example.com/a?utm_source=x", 1, 0); // dup of a, lower
    const c = make(3, "https://example.com/c", 2, 0);
    const result = dedupCandidates([a, b, c]);
    expect(result.map((i) => i.id)).toEqual([1, 3]);
  });

  it("passes through unique URLs in original order", () => {
    const items: DedupCandidate[] = [
      make(1, "https://example.com/a", 1, 0),
      make(2, "https://example.com/b", 2, 0),
      make(3, "https://example.com/c", 3, 0),
    ];
    const result = dedupCandidates(items);
    expect(result.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it("returns empty array for empty input", () => {
    expect(dedupCandidates([])).toEqual([]);
  });

  it("on engagement tie, keeps the first occurrence (deterministic)", () => {
    const items: DedupCandidate[] = [
      make(1, "https://example.com/post", 5, 5),
      make(2, "https://example.com/post?utm_source=x", 5, 5),
    ];
    const result = dedupCandidates(items);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(1);
  });

  it("handles a mix of canonicalizable and non-canonicalizable URLs", () => {
    const items: DedupCandidate[] = [
      make(1, "https://example.com/post/?utm_source=x", 3, 0),
      make(2, "not-a-url", 1, 0),
      make(3, "https://example.com/post", 10, 0),
      make(4, "not-a-url", 7, 0),
    ];
    const result = dedupCandidates(items);
    expect(result.map((i) => i.id)).toEqual([3, 4]);
  });
});
