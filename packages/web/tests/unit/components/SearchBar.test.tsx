import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useSearchParams } from "react-router-dom";
import type { ReactElement } from "react";
import { SearchBar } from "../../../src/components/archive-listing/SearchBar";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function ParamsProbe({ onChange }: { onChange: (s: string) => void }): ReactElement {
  const [params] = useSearchParams();
  onChange(params.toString());
  return <></>;
}

function renderWithRouter(initial = "/"): { paramsLog: string[] } {
  const paramsLog: string[] = [];
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SearchBar />
              <ParamsProbe onChange={(s) => paramsLog.push(s)} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { paramsLog };
}

describe("SearchBar", () => {
  it("renders the search input with placeholder", () => {
    renderWithRouter();
    expect(screen.getByLabelText(/search the archive/i)).toBeTruthy();
  });

  it("seeds value from the ?q= URL param", () => {
    renderWithRouter("/?q=speculative");
    const input = screen.getByLabelText(/search the archive/i);
    expect((input as HTMLInputElement).value).toBe("speculative");
  });

  it("debounces and pushes ?q= to URL after the user types ≥2 chars", () => {
    vi.useFakeTimers();
    const { paramsLog } = renderWithRouter("/");
    const input = screen.getByLabelText(/search the archive/i);
    fireEvent.change(input, { target: { value: "ag" } });
    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(paramsLog.at(-1)).toContain("q=ag");
  });

  it("does NOT push to URL for a 1-char query", () => {
    vi.useFakeTimers();
    const { paramsLog } = renderWithRouter("/");
    const input = screen.getByLabelText(/search the archive/i);
    fireEvent.change(input, { target: { value: "a" } });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(paramsLog.at(-1)).toBe("");
  });

  it("clears the ?q= param when input is emptied", () => {
    vi.useFakeTimers();
    const { paramsLog } = renderWithRouter("/?q=hello");
    const input = screen.getByLabelText(/search the archive/i);
    fireEvent.change(input, { target: { value: "" } });
    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(paramsLog.at(-1)).toBe("");
  });

  it("focuses the input when ⌘K is pressed", () => {
    renderWithRouter();
    const input = screen.getByLabelText(/search the archive/i);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(input);
  });

  it("blurs on Escape while focused", () => {
    renderWithRouter();
    const input = screen.getByLabelText(/search the archive/i);
    (input as HTMLInputElement).focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).not.toBe(input);
  });

  it("displays the ⌘K hint", () => {
    renderWithRouter();
    expect(screen.getByText("⌘K")).toBeTruthy();
  });
});
