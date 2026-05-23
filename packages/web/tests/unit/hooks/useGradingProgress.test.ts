import { describe, expect, it, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useGradingProgress } from "../../../src/hooks/useGradingProgress";

beforeEach(() => {
  window.localStorage.clear();
});

describe("useGradingProgress", () => {
  it("setLabel persists to localStorage", () => {
    const { result } = renderHook(() => useGradingProgress("fx-1", "aman"));
    act(() => {
      result.current.setLabel(101, "must");
    });
    expect(result.current.labels[101]).toBe("must");
    const raw = window.localStorage.getItem("eval-grade:fx-1:aman");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "{}") as Record<string, string>;
    expect(parsed["101"]).toBe("must");
  });

  it("hydrates initial state from localStorage", () => {
    window.localStorage.setItem(
      "eval-grade:fx-2:aman",
      JSON.stringify({ 5: "drop" }),
    );
    const { result } = renderHook(() => useGradingProgress("fx-2", "aman"));
    expect(result.current.labels[5]).toBe("drop");
  });

  it("clearAll removes the localStorage key", () => {
    window.localStorage.setItem(
      "eval-grade:fx-3:aman",
      JSON.stringify({ 1: "must" }),
    );
    const { result } = renderHook(() => useGradingProgress("fx-3", "aman"));
    expect(result.current.labels[1]).toBe("must");
    act(() => {
      result.current.clearAll();
    });
    expect(result.current.labels).toEqual({});
    expect(window.localStorage.getItem("eval-grade:fx-3:aman")).toBeNull();
  });

  it("isComplete returns true only when every representative ID has a label", () => {
    const { result } = renderHook(() => useGradingProgress("fx-4", "aman"));
    expect(result.current.isComplete([1, 2, 3])).toBe(false);
    act(() => {
      result.current.setLabel(1, "must");
      result.current.setLabel(2, "nice");
    });
    expect(result.current.isComplete([1, 2, 3])).toBe(false);
    act(() => {
      result.current.setLabel(3, "drop");
    });
    expect(result.current.isComplete([1, 2, 3])).toBe(true);
  });

  it("isComplete returns false for an empty cluster list", () => {
    const { result } = renderHook(() => useGradingProgress("fx-5", "aman"));
    expect(result.current.isComplete([])).toBe(false);
  });
});
