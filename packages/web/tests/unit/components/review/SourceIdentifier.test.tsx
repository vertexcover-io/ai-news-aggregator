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

describe("ReviewCard sourceIdentifier (REQ-018)", () => {
  it("renders blog sourceIdentifier next to source badge", () => {
    const item: RankedItem = {
      id: 1,
      rawItemId: 10,
      title: "Blog Post",
      url: "https://openai.com/post",
      sourceType: "blog",
      author: null,
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      score: 0.9,
      rationale: "r",
      content: null,
      imageUrl: null,
      recap: null,
      enrichedSource: null,
      sourceIdentifier: "openai.com",
      preview: noPreview,
    };
    render(
      <ReviewCard
        item={item}
        rank={1}
        isAdded={false}
        onDelete={vi.fn()}
        onUpdateField={vi.fn()}
      />,
    );
    expect(screen.getByText("openai.com")).toBeTruthy();
    // Source badge still present
    expect(screen.getByText("blog")).toBeTruthy();
  });

  it("renders twitter sourceIdentifier (@handle) next to source badge", () => {
    const item: RankedItem = {
      id: 2,
      rawItemId: 20,
      title: "Tweet",
      url: "https://x.com/karpathy/status/1",
      sourceType: "twitter",
      author: "karpathy",
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      score: 0.8,
      rationale: "r",
      content: null,
      imageUrl: null,
      recap: null,
      enrichedSource: null,
      sourceIdentifier: "@karpathy",
      preview: noPreview,
    };
    render(
      <ReviewCard
        item={item}
        rank={1}
        isAdded={false}
        onDelete={vi.fn()}
        onUpdateField={vi.fn()}
      />,
    );
    expect(screen.getByText("@karpathy")).toBeTruthy();
    expect(screen.getByText("twitter")).toBeTruthy();
  });

  it("renders reddit sourceIdentifier (r/sub) next to source badge", () => {
    const item: RankedItem = {
      id: 3,
      rawItemId: 30,
      title: "Reddit Post",
      url: "https://reddit.com/r/LocalLLaMA/comments/xyz",
      sourceType: "reddit",
      author: null,
      publishedAt: null,
      engagement: { points: 50, commentCount: 5 },
      score: 0.7,
      rationale: "r",
      content: null,
      imageUrl: null,
      recap: null,
      enrichedSource: null,
      sourceIdentifier: "r/LocalLLaMA",
      preview: noPreview,
    };
    render(
      <ReviewCard
        item={item}
        rank={1}
        isAdded={false}
        onDelete={vi.fn()}
        onUpdateField={vi.fn()}
      />,
    );
    expect(screen.getByText("r/LocalLLaMA")).toBeTruthy();
  });

  it("renders web_search sourceIdentifier (domain) next to source badge", () => {
    const item: RankedItem = {
      id: 4,
      rawItemId: 40,
      title: "Web Search Result",
      url: "https://techcrunch.com/article",
      sourceType: "web_search" as RankedItem["sourceType"],
      author: null,
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      score: 0.6,
      rationale: "r",
      content: null,
      imageUrl: null,
      recap: null,
      enrichedSource: null,
      sourceIdentifier: "techcrunch.com",
      preview: noPreview,
    };
    render(
      <ReviewCard
        item={item}
        rank={1}
        isAdded={false}
        onDelete={vi.fn()}
        onUpdateField={vi.fn()}
      />,
    );
    expect(screen.getByText("techcrunch.com")).toBeTruthy();
  });
});

describe("PoolCard sourceIdentifier (REQ-018)", () => {
  it("renders blog sourceIdentifier next to source badge", () => {
    const item: PoolItem = {
      id: 10,
      title: "Blog in Pool",
      url: "https://anthropic.com/post",
      sourceType: "blog",
      author: null,
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      imageUrl: null,
      sourceIdentifier: "anthropic.com",
      preview: noPreview,
      recapSummary: null,
    };
    render(
      <PoolCard
        item={item}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );
    expect(screen.getByText("anthropic.com")).toBeTruthy();
    expect(screen.getByText("blog")).toBeTruthy();
  });

  it("renders twitter sourceIdentifier (@handle) in pool card", () => {
    const item: PoolItem = {
      id: 11,
      title: "Tweet in Pool",
      url: "https://x.com/sama/status/2",
      sourceType: "twitter",
      author: "sama",
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      imageUrl: null,
      sourceIdentifier: "@sama",
      preview: noPreview,
      recapSummary: null,
    };
    render(
      <PoolCard
        item={item}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );
    expect(screen.getByText("@sama")).toBeTruthy();
  });
});
