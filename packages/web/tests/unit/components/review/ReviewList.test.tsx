import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { RankedItem } from "@newsletter/shared";
import { ReviewList } from "../../../../src/components/review/ReviewList";

function makeItem(id: number, title: string): RankedItem {
  return {
    id,
    rawItemId: id,
    title,
    url: `https://example.com/${String(id)}`,
    sourceType: "hn",
    author: null,
    publishedAt: null,
    engagement: { points: 0, commentCount: 0 },
    score: 0.5,
    rationale: "r",
    content: null,
    imageUrl: null,
    recap: null,
  };
}

afterEach(() => {
  cleanup();
});

describe("ReviewList", () => {
  it("renders one article per item with a sortable handle (REQ-120, REQ-124)", () => {
    render(
      <ReviewList
        items={[makeItem(1, "A"), makeItem(2, "B")]}
        addedIds={new Set()}
        onReorder={vi.fn()}
        onDelete={vi.fn()}
        onUpdateField={vi.fn()}
        pendingCount={0}
      />,
    );
    expect(screen.getAllByRole("article")).toHaveLength(2);
    const handles = screen.getAllByLabelText("Drag to reorder");
    expect(handles).toHaveLength(2);
    // @dnd-kit sets aria-roledescription="sortable" on the handle attributes.
    for (const handle of handles) {
      expect(handle.getAttribute("aria-roledescription")).toBe("sortable");
    }
  });

  it("calls onDelete with the item id when the delete button is clicked (REQ-123)", () => {
    const onDelete = vi.fn();
    render(
      <ReviewList
        items={[makeItem(1, "A"), makeItem(7, "Target")]}
        addedIds={new Set()}
        onReorder={vi.fn()}
        onDelete={onDelete}
        onUpdateField={vi.fn()}
        pendingCount={0}
      />,
    );
    const btn = screen.getByLabelText("Remove Target");
    fireEvent.click(btn);
    expect(onDelete).toHaveBeenCalledWith(7);
  });

  it("renders pending placeholder nodes at the bottom (REQ-132)", () => {
    const { container } = render(
      <ReviewList
        items={[makeItem(1, "A")]}
        addedIds={new Set()}
        onReorder={vi.fn()}
        onDelete={vi.fn()}
        onUpdateField={vi.fn()}
        pendingCount={1}
      />,
    );
    const pendingNodes = container.querySelectorAll('[data-pending="true"]');
    expect(pendingNodes).toHaveLength(1);
  });

  it("renders 'Added by you' badge for added items (REQ-125)", () => {
    render(
      <ReviewList
        items={[makeItem(99, "Manual")]}
        addedIds={new Set([99])}
        onReorder={vi.fn()}
        onDelete={vi.fn()}
        onUpdateField={vi.fn()}
        pendingCount={0}
      />,
    );
    const article = screen.getAllByRole("article")[0];
    expect(article.getAttribute("data-added")).toBe("true");
    expect(screen.getAllByText(/Added by you/).length).toBeGreaterThan(0);
  });
});
