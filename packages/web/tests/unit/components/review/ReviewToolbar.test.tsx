import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { SourceFacetGroup } from "../../../../src/hooks/useSourceFacets";
import { ReviewToolbar } from "../../../../src/components/review/ReviewToolbar";

afterEach(() => {
  cleanup();
});

const mockFacets: SourceFacetGroup[] = [
  {
    sourceType: "blog",
    facets: [
      { sourceIdentifier: "openai.com", count: 5 },
      { sourceIdentifier: "anthropic.com", count: 3 },
    ],
  },
  {
    sourceType: "reddit",
    facets: [{ sourceIdentifier: "r/LocalLLaMA", count: 8 }],
  },
];

function makeProps(overrides: Partial<Parameters<typeof ReviewToolbar>[0]> = {}): Parameters<typeof ReviewToolbar>[0] {
  return {
    shortlistedOnly: false,
    toggleShortlisted: vi.fn(),
    shortlistedItemIds: [1, 2, 3],
    selectedSources: new Set<string>(),
    toggleSource: vi.fn(),
    clearAll: vi.fn(),
    facets: mockFacets,
    facetsLoading: false,
    rankedVisibleCount: 5,
    rankedTotalCount: 10,
    poolTotalCount: 20,
    isFiltered: false,
    ...overrides,
  };
}

describe("ReviewToolbar", () => {
  it("REQ-014: shortlisted toggle is disabled when shortlistedItemIds is null", () => {
    render(<ReviewToolbar {...makeProps({ shortlistedItemIds: null })} />);
    const toggle = screen.getByRole("checkbox", { name: /shortlisted/i });
    expect(toggle.hasAttribute("disabled")).toBe(true);
  });

  it("REQ-014: disabled toggle has a tooltip attribute or aria-description when null", () => {
    const { container } = render(
      <ReviewToolbar {...makeProps({ shortlistedItemIds: null })} />,
    );
    // Should have some indicator of why it's disabled
    const toggle = screen.getByRole("checkbox", { name: /shortlisted/i });
    const hasTitle = toggle.hasAttribute("title");
    const wrapper = container.querySelector("[title]");
    expect(hasTitle || wrapper !== null).toBe(true);
  });

  it("shortlisted toggle is enabled when shortlistedItemIds is an array", () => {
    render(<ReviewToolbar {...makeProps({ shortlistedItemIds: [1, 2] })} />);
    const toggle = screen.getByRole("checkbox", { name: /shortlisted/i });
    expect(toggle.hasAttribute("disabled")).toBe(false);
  });

  it("clicking toggle calls toggleShortlisted", () => {
    const toggleShortlisted = vi.fn();
    render(<ReviewToolbar {...makeProps({ toggleShortlisted })} />);
    const toggle = screen.getByRole("checkbox", { name: /shortlisted/i });
    fireEvent.click(toggle);
    expect(toggleShortlisted).toHaveBeenCalledOnce();
  });

  it("shows active chip for selected source", () => {
    render(
      <ReviewToolbar
        {...makeProps({ selectedSources: new Set(["openai.com"]) })}
      />,
    );
    expect(screen.getByText("openai.com")).toBeTruthy();
  });

  it("removing a chip calls toggleSource with the identifier", () => {
    const toggleSource = vi.fn();
    render(
      <ReviewToolbar
        {...makeProps({
          selectedSources: new Set(["openai.com"]),
          toggleSource,
        })}
      />,
    );
    // Find chip remove button
    const chipRemove = screen.getByRole("button", {
      name: /remove openai\.com/i,
    });
    fireEvent.click(chipRemove);
    expect(toggleSource).toHaveBeenCalledWith("openai.com");
  });

  it("'Clear filters' button calls clearAll", () => {
    const clearAll = vi.fn();
    render(
      <ReviewToolbar
        {...makeProps({
          isFiltered: true,
          clearAll,
          selectedSources: new Set(["openai.com"]),
        })}
      />,
    );
    const clearBtn = screen.getByRole("button", { name: /clear filters/i });
    fireEvent.click(clearBtn);
    expect(clearAll).toHaveBeenCalledOnce();
  });

  it("'Clear filters' is not shown when isFiltered is false", () => {
    render(<ReviewToolbar {...makeProps({ isFiltered: false })} />);
    expect(screen.queryByRole("button", { name: /clear filters/i })).toBeNull();
  });

  it("shows 'Showing N of M' count text", () => {
    render(
      <ReviewToolbar
        {...makeProps({ rankedVisibleCount: 3, rankedTotalCount: 10 })}
      />,
    );
    expect(screen.getByText(/showing/i)).toBeTruthy();
  });
});
