import { describe, expect, it } from "vitest";
import {
  buildRecapContent,
  resolveDisplayTitle,
  resolveEnrichedSource,
} from "../../../src/services/rank-hydration.js";
import type { RankedItemRef, RecapContent } from "@newsletter/shared";

const baseRef: RankedItemRef = {
  rawItemId: 1,
  sourceType: "hn",
  score: 0.5,
  rationale: "",
};

const rawRecap: RecapContent = {
  title: "raw title",
  summary: "raw summary",
  bullets: ["bullet"],
  bottomLine: "raw bottom",
};

describe("buildRecapContent", () => {
  it("returns null when no ref fields and no raw recap", () => {
    expect(buildRecapContent(baseRef, null)).toBeNull();
    expect(buildRecapContent(baseRef, undefined)).toBeNull();
  });

  it("returns rawRecap unchanged when no ref overrides", () => {
    expect(buildRecapContent(baseRef, rawRecap)).toBe(rawRecap);
  });

  it("merges ref.title with raw fallbacks when only title is set", () => {
    const ref: RankedItemRef = { ...baseRef, title: "override title" };
    const result = buildRecapContent(ref, rawRecap);
    expect(result).toEqual({
      title: "override title",
      summary: "raw summary",
      bullets: ["bullet"],
      bottomLine: "raw bottom",
    });
  });

  it("fills empty strings when ref overrides but no raw recap", () => {
    const ref: RankedItemRef = { ...baseRef, title: "t", summary: "s" };
    const result = buildRecapContent(ref, null);
    expect(result).toEqual({
      title: "t",
      summary: "s",
      bullets: [],
      bottomLine: "",
    });
  });

  it("overrides all fields from ref", () => {
    const ref: RankedItemRef = {
      ...baseRef,
      title: "rt",
      summary: "rs",
      bullets: ["b1", "b2"],
      bottomLine: "rb",
    };
    expect(buildRecapContent(ref, rawRecap)).toEqual({
      title: "rt",
      summary: "rs",
      bullets: ["b1", "b2"],
      bottomLine: "rb",
    });
  });
});

describe("resolveDisplayTitle", () => {
  it("prefers ref.title", () => {
    const ref: RankedItemRef = { ...baseRef, title: "ref title" };
    expect(resolveDisplayTitle(ref, rawRecap, "row title")).toBe("ref title");
  });

  it("falls back to rawRecap.title when ref has no title", () => {
    expect(resolveDisplayTitle(baseRef, rawRecap, "row title")).toBe(
      "raw title",
    );
  });

  it("falls back to row.title when both ref and rawRecap are absent", () => {
    expect(resolveDisplayTitle(baseRef, null, "row title")).toBe("row title");
    expect(resolveDisplayTitle(baseRef, undefined, "row title")).toBe(
      "row title",
    );
  });
});

describe("resolveEnrichedSource", () => {
  const makeRow = (
    enrichedLink: Record<string, unknown> | undefined,
  ) =>
    ({
      content: null,
      metadata: { enrichedLink } as { enrichedLink: unknown },
    }) as Parameters<typeof resolveEnrichedSource>[0];

  it("returns null for legacy archives", () => {
    expect(resolveEnrichedSource(makeRow(undefined), true)).toBeNull();
  });

  it("returns null when enrichedLink is absent", () => {
    expect(resolveEnrichedSource(makeRow(undefined), false)).toBeNull();
  });

  it("returns hostname + url when enrichedLink is present and ok", () => {
    const row = makeRow({
      status: "ok",
      url: "https://example.com/post",
      markdown: "some content",
    });
    const result = resolveEnrichedSource(row, false);
    expect(result).toEqual({ hostname: "example.com", url: "https://example.com/post" });
  });
});
