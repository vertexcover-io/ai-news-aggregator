import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import type { ReactElement } from "react";
import { SearchBar } from "../../../../src/components/archive-listing/SearchBar";

function ParamsProbe(): ReactElement {
  const [params] = useSearchParams();
  return <div data-testid="qparam">{params.get("q") ?? ""}</div>;
}

function renderBar(initialEntries: string[] = ["/"]): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <SearchBar />
              <ParamsProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("SearchBar", () => {
  it("renders placeholder 'Search the archive…' and the ⌕ glyph", () => {
    renderBar();
    const input = screen.getByPlaceholderText("Search the archive…");
    expect(input).toBeTruthy();
    // Glyph rendered somewhere in the bar (sibling of the input).
    expect(screen.getByText("⌕")).toBeTruthy();
  });

  it("debounces URL update by 250ms when query length >= 2", () => {
    renderBar();
    const input = screen.getByPlaceholderText("Search the archive…");
    fireEvent.change(input, { target: { value: "agentic" } });
    expect(screen.getByTestId("qparam").textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(screen.getByTestId("qparam").textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("qparam").textContent).toBe("agentic");
  });

  it("EDGE-002: 1-char query does NOT update URL", () => {
    renderBar();
    const input = screen.getByPlaceholderText("Search the archive…");
    fireEvent.change(input, { target: { value: "a" } });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId("qparam").textContent).toBe("");
  });

  it("clearing input back to empty string updates URL to remove q", () => {
    renderBar(["/?q=foo"]);
    const input = screen.getByPlaceholderText<HTMLInputElement>("Search the archive…");
    expect(input.value).toBe("foo");
    fireEvent.change(input, { target: { value: "" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByTestId("qparam").textContent).toBe("");
  });

  it("Clear button is shown when q is non-empty and clears the URL", () => {
    renderBar(["/?q=foo"]);
    const clear = screen.getByRole("button", { name: /clear/i });
    expect(clear).toBeTruthy();
    fireEvent.click(clear);
    expect(screen.getByTestId("qparam").textContent).toBe("");
  });

  it("Clear button is hidden when q is empty", () => {
    renderBar();
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
  });
});
