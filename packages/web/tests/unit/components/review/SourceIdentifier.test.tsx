import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RankedItem, PoolItem } from "@newsletter/shared/types";
import { ReviewCard } from "../../../../src/components/review/ReviewCard";
import { PoolCard } from "../../../../src/components/review/PoolCard";

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}));

const noPreview = { kind: "none" as const };

afterEach(() => {
  cleanup();
});

function makeRankedItem(
  sourceType: RankedItem["sourceType"],
  sourceIdentifier: string,
): RankedItem {
  return {
    id: 1,
    rawItemId: 10,
    title: "Item",
    url: "https://example.com/post",
    sourceType,
    author: null,
    publishedAt: null,
    engagement: { points: 0, commentCount: 0 },
    score: 0.9,
    rationale: "r",
    content: null,
    imageUrl: null,
    recap: null,
    enrichedSource: null,
    sourceIdentifier,
    preview: noPreview,
  };
}

function makePoolItem(
  sourceType: PoolItem["sourceType"],
  sourceIdentifier: string,
): PoolItem {
  return {
    id: 10,
    title: "Pool item",
    url: "https://example.com/post",
    sourceType,
    author: null,
    publishedAt: null,
    engagement: { points: 0, commentCount: 0 },
    imageUrl: null,
    sourceIdentifier,
    preview: noPreview,
    recapSummary: null,
  };
}

describe("ReviewCard sourceIdentifier (REQ-018)", () => {
  // Each collector renders its sourceIdentifier next to the sourceType badge.
  it.each<{ sourceType: RankedItem["sourceType"]; identifier: string }>([
    { sourceType: "blog", identifier: "openai.com" },
    { sourceType: "twitter", identifier: "@karpathy" },
    { sourceType: "reddit", identifier: "r/LocalLLaMA" },
    { sourceType: "web_search", identifier: "techcrunch.com" },
  ])("renders $sourceType identifier $identifier next to source badge", ({ sourceType, identifier }) => {
    render(
      <ReviewCard
        item={makeRankedItem(sourceType, identifier)}
        rank={1}
        isAdded={false}
        onDelete={vi.fn()}
        onUpdateField={vi.fn()}
      />,
    );
    expect(screen.getByText(identifier)).toBeTruthy();
    expect(screen.getByText(sourceType)).toBeTruthy();
  });
});

describe("PoolCard sourceIdentifier (REQ-018)", () => {
  it.each<{ sourceType: PoolItem["sourceType"]; identifier: string }>([
    { sourceType: "blog", identifier: "anthropic.com" },
    { sourceType: "twitter", identifier: "@sama" },
  ])("renders $sourceType identifier $identifier next to source badge", ({ sourceType, identifier }) => {
    render(
      <PoolCard
        item={makePoolItem(sourceType, identifier)}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );
    expect(screen.getByText(identifier)).toBeTruthy();
    expect(screen.getByText(sourceType)).toBeTruthy();
  });
});
