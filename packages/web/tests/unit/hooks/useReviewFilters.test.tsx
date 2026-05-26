import { describe, expect, it, afterEach } from "vitest";
import { act, renderHook, cleanup } from "@testing-library/react";
import { useReviewFilters } from "../../../src/hooks/useReviewFilters";

afterEach(() => {
  cleanup();
});

describe("useReviewFilters", () => {
  it("initial state: shortlistedOnly=false, selectedSources empty", () => {
    const { result } = renderHook(() => useReviewFilters());
    expect(result.current.shortlistedOnly).toBe(false);
    expect(result.current.selectedSources.size).toBe(0);
  });

  it("toggleShortlisted flips shortlistedOnly", () => {
    const { result } = renderHook(() => useReviewFilters());
    act(() => {
      result.current.toggleShortlisted();
    });
    expect(result.current.shortlistedOnly).toBe(true);
    act(() => {
      result.current.toggleShortlisted();
    });
    expect(result.current.shortlistedOnly).toBe(false);
  });

  it("toggleSource adds a source to selectedSources", () => {
    const { result } = renderHook(() => useReviewFilters());
    act(() => {
      result.current.toggleSource("openai.com");
    });
    expect(result.current.selectedSources.has("openai.com")).toBe(true);
    expect(result.current.selectedSources.size).toBe(1);
  });

  it("toggleSource removes an already-selected source (toggle off)", () => {
    const { result } = renderHook(() => useReviewFilters());
    act(() => {
      result.current.toggleSource("openai.com");
    });
    act(() => {
      result.current.toggleSource("openai.com");
    });
    expect(result.current.selectedSources.has("openai.com")).toBe(false);
    expect(result.current.selectedSources.size).toBe(0);
  });

  it("multiple sources can be selected (OR semantics within sources)", () => {
    const { result } = renderHook(() => useReviewFilters());
    act(() => {
      result.current.toggleSource("openai.com");
      result.current.toggleSource("r/LocalLLaMA");
    });
    expect(result.current.selectedSources.has("openai.com")).toBe(true);
    expect(result.current.selectedSources.has("r/LocalLLaMA")).toBe(true);
    expect(result.current.selectedSources.size).toBe(2);
  });

  it("clearSources resets selectedSources to empty", () => {
    const { result } = renderHook(() => useReviewFilters());
    act(() => {
      result.current.toggleSource("openai.com");
      result.current.toggleSource("r/LocalLLaMA");
    });
    act(() => {
      result.current.clearSources();
    });
    expect(result.current.selectedSources.size).toBe(0);
  });

  it("clearAll resets both shortlistedOnly and selectedSources", () => {
    const { result } = renderHook(() => useReviewFilters());
    act(() => {
      result.current.toggleShortlisted();
      result.current.toggleSource("openai.com");
    });
    act(() => {
      result.current.clearAll();
    });
    expect(result.current.shortlistedOnly).toBe(false);
    expect(result.current.selectedSources.size).toBe(0);
  });

  it("isFiltered returns false when no filters active", () => {
    const { result } = renderHook(() => useReviewFilters());
    expect(result.current.isFiltered).toBe(false);
  });

  it("isFiltered returns true when shortlistedOnly is active", () => {
    const { result } = renderHook(() => useReviewFilters());
    act(() => {
      result.current.toggleShortlisted();
    });
    expect(result.current.isFiltered).toBe(true);
  });

  it("isFiltered returns true when selectedSources has entries", () => {
    const { result } = renderHook(() => useReviewFilters());
    act(() => {
      result.current.toggleSource("openai.com");
    });
    expect(result.current.isFiltered).toBe(true);
  });
});
