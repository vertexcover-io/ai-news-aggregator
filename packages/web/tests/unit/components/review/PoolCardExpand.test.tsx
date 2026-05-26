import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PoolItem } from "@newsletter/shared/types";
import { PoolCard } from "../../../../src/components/review/PoolCard";

afterEach(() => {
  cleanup();
});

const linkPreviewItem: PoolItem = {
  id: 1,
  title: "Blog Post",
  url: "https://openai.com/post",
  sourceType: "blog",
  author: null,
  publishedAt: null,
  engagement: { points: 100, commentCount: 5 },
  imageUrl: null,
  sourceIdentifier: "openai.com",
  preview: {
    kind: "link",
    title: "Great Article",
    byline: "Jane Doe",
    description: "An article about AI",
    imageUrl: null,
    domain: "openai.com",
    markdownExcerpt: "Key point here",
    url: "https://openai.com/post",
  },
  recapSummary: null,
};

const tweetItem: PoolItem = {
  id: 2,
  title: "Tweet",
  url: "https://x.com/user/status/1",
  sourceType: "twitter",
  author: "user",
  publishedAt: null,
  engagement: { points: 0, commentCount: 0 },
  imageUrl: null,
  sourceIdentifier: "@user",
  preview: {
    kind: "tweet",
    handle: "@user",
    text: "Tweet text here",
    createdAt: null,
    photoUrls: [],
    url: "https://x.com/user/status/1",
    quoted: null,
  },
  recapSummary: null,
};

const noPreviewItem: PoolItem = {
  id: 3,
  title: "No Preview Item",
  url: "https://example.com",
  sourceType: "hn",
  author: null,
  publishedAt: null,
  engagement: { points: 0, commentCount: 0 },
  imageUrl: null,
  sourceIdentifier: "example.com",
  preview: { kind: "none" },
  recapSummary: null,
};

describe("PoolCard expand/collapse (REQ-019, REQ-020)", () => {
  it("REQ-020: pool card renders collapsed by default — no preview content visible", () => {
    render(
      <PoolCard
        item={linkPreviewItem}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );
    // Preview content not visible by default
    expect(screen.queryByText("Great Article")).toBeNull();
    expect(screen.queryByText("Key point here")).toBeNull();
  });

  it("REQ-020: expand button is present on pool card", () => {
    render(
      <PoolCard
        item={linkPreviewItem}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );
    const expandBtn = screen.getByRole("button", { name: /expand/i });
    expect(expandBtn).toBeTruthy();
  });

  it("REQ-019: clicking expand shows the preview content", () => {
    render(
      <PoolCard
        item={linkPreviewItem}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );
    const expandBtn = screen.getByRole("button", { name: /expand/i });
    fireEvent.click(expandBtn);
    expect(screen.getByText("Great Article")).toBeTruthy();
  });

  it("REQ-019: clicking expand again collapses the preview", () => {
    render(
      <PoolCard
        item={linkPreviewItem}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );
    const expandBtn = screen.getByRole("button", { name: /expand/i });
    fireEvent.click(expandBtn);
    // Now collapse
    const collapseBtn = screen.getByRole("button", { name: /collapse/i });
    fireEvent.click(collapseBtn);
    expect(screen.queryByText("Great Article")).toBeNull();
  });

  it("REQ-019: expanding a tweet card shows tweet text", () => {
    render(
      <PoolCard
        item={tweetItem}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /expand/i }));
    expect(screen.getByText("Tweet text here")).toBeTruthy();
  });

  it("EDGE-003: expanding a no-preview card shows unavailable message (never blank)", () => {
    render(
      <PoolCard
        item={noPreviewItem}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /expand/i }));
    expect(screen.getByText(/full preview unavailable/i)).toBeTruthy();
  });

  it("EDGE-003: expanding a no-preview card with recapSummary shows the recap summary", () => {
    const itemWithRecap: PoolItem = {
      ...noPreviewItem,
      recapSummary: "LLaMA 4 sets a new open-weights benchmark.",
    };
    render(
      <PoolCard
        item={itemWithRecap}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /expand/i }));
    expect(screen.getByText("LLaMA 4 sets a new open-weights benchmark.")).toBeTruthy();
    expect(screen.getByText(/full preview unavailable/i)).toBeTruthy();
  });
});
