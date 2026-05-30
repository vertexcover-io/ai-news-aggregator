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
      { sourceIdentifier: "openai.com", displayName: "openai.com", count: 5 },
      { sourceIdentifier: "anthropic.com", displayName: "anthropic.com", count: 3 },
    ],
  },
  {
    sourceType: "reddit",
    facets: [
      { sourceIdentifier: "r/LocalLLaMA", displayName: "r/LocalLLaMA", count: 8 },
    ],
  },
  {
    sourceType: "twitter",
    facets: [
      {
        sourceIdentifier: "list:158",
        displayName: "Twitter list 158",
        count: 100,
      },
    ],
  },
];

function makeProps(
  overrides: Partial<Parameters<typeof ReviewToolbar>[0]> = {},
): Parameters<typeof ReviewToolbar>[0] {
  return {
    shortlistedOnly: false,
    toggleShortlisted: vi.fn(),
    shortlistedItemIds: [1, 2, 3],
    sourceTypes: ["blog", "reddit", "twitter"],
    selectedSourceTypes: new Set<string>(),
    toggleSourceType: vi.fn(),
    selectedSources: new Set<string>(),
    toggleSource: vi.fn(),
    clearAll: vi.fn(),
    facets: mockFacets,
    facetsLoading: false,
    poolTotalCount: 20,
    isFiltered: false,
    ...overrides,
  };
}

function makePropsWithCollectorFilters(
  overrides: Partial<Parameters<typeof ReviewToolbar>[0]> = {},
): Parameters<typeof ReviewToolbar>[0] {
  return {
    ...makeProps(overrides),
    sourceTypes: overrides.sourceTypes ?? ["hn", "blog", "web_search", "reddit"],
    selectedSourceTypes: overrides.selectedSourceTypes ?? new Set<string>(),
    toggleSourceType: overrides.toggleSourceType ?? vi.fn(),
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

  it("renders the unit displayName (not the raw identifier) for a Twitter list", () => {
    render(<ReviewToolbar {...makeProps({ selectedSources: new Set(["list:158"]) })} />);
    // Active chip shows the human label, not "list:158"
    expect(screen.getByText("Twitter list 158")).toBeTruthy();
    expect(screen.queryByText("list:158")).toBeNull();
  });

  it("removing a Twitter-list chip still toggles by identifier", () => {
    const toggleSource = vi.fn();
    render(
      <ReviewToolbar
        {...makeProps({ selectedSources: new Set(["list:158"]), toggleSource })}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /remove twitter list 158/i }),
    );
    expect(toggleSource).toHaveBeenCalledWith("list:158");
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

  it("shows the pool item count when not filtered", () => {
    const { container } = render(
      <ReviewToolbar {...makeProps({ poolTotalCount: 20, isFiltered: false })} />,
    );
    expect(container.textContent).toContain("20");
    expect(container.textContent).toContain("items");
  });

  it("shows the matching count when filtered", () => {
    const { container } = render(
      <ReviewToolbar
        {...makeProps({
          poolTotalCount: 7,
          isFiltered: true,
          selectedSources: new Set(["openai.com"]),
        })}
      />,
    );
    expect(container.textContent).toContain("7");
    expect(container.textContent).toContain("matching");
  });

  it("renders collector filters and granular source filters in one source menu", () => {
    render(<ReviewToolbar {...makePropsWithCollectorFilters()} />);

    fireEvent.click(screen.getByRole("button", { name: /source/i }));

    expect(screen.getByRole("button", { name: /hacker news/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /engineering blogs/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /web search/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /openai\.com/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /anthropic\.com/i })).toBeTruthy();
  });

  it("does not render source-level options for single-entity collectors", () => {
    render(
      <ReviewToolbar
        {...makePropsWithCollectorFilters({
          facets: [
            {
              sourceType: "hn",
              facets: [
                {
                  sourceIdentifier: "hn:frontpage",
                  displayName: "Hacker News frontpage",
                  count: 12,
                },
              ],
            },
            {
              sourceType: "web_search",
              facets: [
                {
                  sourceIdentifier: "agent news",
                  displayName: "agent news",
                  count: 9,
                },
              ],
            },
          ],
          sourceTypes: ["hn", "web_search"],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /source/i }));

    expect(screen.getByRole("button", { name: /^hacker news/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^web search/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /frontpage/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^agent news/i })).toBeNull();
  });

  it("selecting a collector filter toggles by source type", () => {
    const toggleSourceType = vi.fn();
    render(
      <ReviewToolbar
        {...makePropsWithCollectorFilters({
          sourceTypes: ["blog"],
          toggleSourceType,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /source/i }));
    fireEvent.click(screen.getByRole("button", { name: /engineering blogs/i }));

    expect(toggleSourceType).toHaveBeenCalledWith("blog");
  });
});
