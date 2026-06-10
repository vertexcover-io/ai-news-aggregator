import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Footer } from "../../../../src/components/shell/Footer";

vi.mock("../../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../../src/lib/analytics", () => ({
  captureBrowserEvent: vi.fn(),
}));

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* localStorage not available in this jsdom build */
  }
});

function renderFooter(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  );
}

describe("Footer", () => {
  it("renders an inline email subscribe field and button in the footer", () => {
    renderFooter();
    // Footer has its own subscribe field (separate from the InlineSubscribeCard).
    const emailInputs = screen
      .getAllByRole("textbox")
      .filter(
        (el): el is HTMLInputElement =>
          el instanceof HTMLInputElement && el.type === "email",
      );
    expect(emailInputs.length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /subscribe|join/i }).length,
    ).toBeGreaterThan(0);
  });

  it("exposes the footer subscribe form as the #subscribe hash target", () => {
    renderFooter();
    const form = screen.getByRole("form", { name: /subscribe in footer/i });
    expect(form.getAttribute("id")).toBe("subscribe");
  });
});
