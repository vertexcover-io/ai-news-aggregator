import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RankedItem } from "@newsletter/shared";
import { ReviewCard } from "../../../../src/components/review/ReviewCard";

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

const baseItem: RankedItem = {
  id: 1,
  rawItemId: 10,
  title: "Test Post",
  url: "https://example.com/post",
  sourceType: "reddit",
  author: "user",
  publishedAt: null,
  engagement: { points: 100, commentCount: 10 },
  score: 0.8,
  rationale: "Good post",
  content: null,
  imageUrl: null,
  recap: null,
};

afterEach(() => {
  cleanup();
});

describe("ReviewCard", () => {
  // REQ-011: img must have referrerpolicy="no-referrer"
  it("sets referrerpolicy=no-referrer on the image element (REQ-011)", () => {
    const item: RankedItem = { ...baseItem, imageUrl: "https://x.com/a.png" };
    const { container } = render(
      <ReviewCard item={item} rank={1} isAdded={false} onDelete={vi.fn()} onUpdateField={vi.fn()} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("does not render an img when imageUrl is null", () => {
    const { container } = render(
      <ReviewCard item={baseItem} rank={1} isAdded={false} onDelete={vi.fn()} onUpdateField={vi.fn()} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows rationale text when recap is null (EDGE-001)", () => {
    const item: RankedItem = { ...baseItem, recap: null, rationale: "Rationale text" };
    render(
      <ReviewCard item={item} rank={1} isAdded={false} onDelete={vi.fn()} onUpdateField={vi.fn()} />,
    );
    expect(screen.getByText("Rationale text")).toBeTruthy();
  });

  it("does not show rationale text when recap is non-null", () => {
    const item: RankedItem = {
      ...baseItem,
      rationale: "Rationale text",
      recap: {
        summary: "Summary text",
        bullets: ["bullet one"],
        bottomLine: "Bottom line",
      },
    };
    render(
      <ReviewCard item={item} rank={1} isAdded={false} onDelete={vi.fn()} onUpdateField={vi.fn()} />,
    );
    expect(screen.queryByText("Rationale text")).toBeNull();
  });

  it("renders summary text when recap is non-null", () => {
    const item: RankedItem = {
      ...baseItem,
      recap: {
        summary: "AI is transforming everything",
        bullets: ["point one"],
        bottomLine: "Take note",
      },
    };
    render(
      <ReviewCard item={item} rank={1} isAdded={false} onDelete={vi.fn()} onUpdateField={vi.fn()} />,
    );
    expect(screen.getByText("AI is transforming everything")).toBeTruthy();
  });

  it("renders bullet text when recap is non-null", () => {
    const item: RankedItem = {
      ...baseItem,
      recap: {
        summary: "Summary",
        bullets: ["bullet alpha", "bullet beta"],
        bottomLine: "Bottom",
      },
    };
    render(
      <ReviewCard item={item} rank={1} isAdded={false} onDelete={vi.fn()} onUpdateField={vi.fn()} />,
    );
    expect(screen.getByText("bullet alpha")).toBeTruthy();
    expect(screen.getByText("bullet beta")).toBeTruthy();
  });
});
