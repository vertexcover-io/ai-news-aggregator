import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PoolItem } from "@newsletter/shared";
import { PoolCard } from "../../../../src/components/review/PoolCard";

const baseItem: PoolItem = {
  id: 42,
  title: "LLaMA 4 Released",
  url: "https://example.com/llama4",
  sourceType: "hn",
  author: "testuser",
  publishedAt: "2026-04-15T12:00:00Z",
  engagement: { points: 150, commentCount: 30 },
  imageUrl: "https://example.com/thumb.png",
  sourceIdentifier: "news.ycombinator.com",
  preview: { kind: "none" },
  recapSummary: null,
};

afterEach(() => {
  cleanup();
});

describe("PoolCard", () => {
  it("REQ-002: renders title, source badge, engagement, relative time, and image", () => {
    render(
      <PoolCard
        item={baseItem}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );

    // Title as link
    const link = screen.getByRole("link", { name: /LLaMA 4 Released/i });
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toBe("https://example.com/llama4");
    expect(link.getAttribute("target")).toBe("_blank");

    // Source badge
    expect(screen.getByText("hn")).toBeDefined();

    // Engagement
    expect(screen.getByText("150 pts")).toBeDefined();
    expect(screen.getByText("30 comments")).toBeDefined();

    // Relative time (contains "ago")
    const timeText = screen.getByText(/ago$/);
    expect(timeText).toBeDefined();

    // Image thumbnail
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/thumb.png");
  });

  it("EDGE-011: shows 'Unknown date' when publishedAt is null", () => {
    const item: PoolItem = { ...baseItem, publishedAt: null };
    render(
      <PoolCard
        item={item}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );
    expect(screen.getByText("Unknown date")).toBeDefined();
  });

  it("EDGE-003: promote button disabled when isSaveInFlight is true", () => {
    render(
      <PoolCard
        item={baseItem}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={true}
      />,
    );
    const btn = screen.getByRole("button", { name: /Promote/i });
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("promote button disabled when isPromoting is true", () => {
    render(
      <PoolCard
        item={baseItem}
        onPromote={vi.fn()}
        isPromoting={true}
        isSaveInFlight={false}
      />,
    );
    const btn = screen.getByRole("button", { name: /Promote/i });
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("REQ-003: calls onPromote with correct rawItemId and title on click", () => {
    const onPromote = vi.fn();
    render(
      <PoolCard
        item={baseItem}
        onPromote={onPromote}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );
    const btn = screen.getByRole("button", { name: /Promote/i });
    fireEvent.click(btn);
    expect(onPromote).toHaveBeenCalledWith(42, "LLaMA 4 Released");
  });

  it("does not render image when imageUrl is null", () => {
    const item: PoolItem = { ...baseItem, imageUrl: null };
    render(
      <PoolCard
        item={item}
        onPromote={vi.fn()}
        isPromoting={false}
        isSaveInFlight={false}
      />,
    );
    expect(document.querySelector("img")).toBeNull();
  });
});
