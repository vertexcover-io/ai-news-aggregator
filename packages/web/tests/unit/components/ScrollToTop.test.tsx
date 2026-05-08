import { describe, expect, it, afterEach, vi } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ScrollToTop } from "../../../src/components/ScrollToTop";

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
});

function setScroll(y: number): void {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true, writable: true });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

describe("ScrollToTop", () => {
  it("is hidden initially (scrollY = 0)", () => {
    render(<ScrollToTop />);
    const btn = screen.getByRole("button", { name: /scroll to top/i });
    expect(btn.getAttribute("data-visible")).toBe("false");
  });

  it("becomes visible after scrolling past 400px", () => {
    render(<ScrollToTop />);
    setScroll(500);
    const btn = screen.getByRole("button", { name: /scroll to top/i });
    expect(btn.getAttribute("data-visible")).toBe("true");
  });

  it("hides again when scrolled back near the top", () => {
    render(<ScrollToTop />);
    setScroll(500);
    setScroll(50);
    const btn = screen.getByRole("button", { name: /scroll to top/i });
    expect(btn.getAttribute("data-visible")).toBe("false");
  });

  it("calls window.scrollTo({ top: 0 }) when clicked", () => {
    const scrollToSpy = vi.fn();
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      writable: true,
      value: scrollToSpy,
    });
    render(<ScrollToTop />);
    setScroll(500);
    fireEvent.click(screen.getByRole("button", { name: /scroll to top/i }));
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});
