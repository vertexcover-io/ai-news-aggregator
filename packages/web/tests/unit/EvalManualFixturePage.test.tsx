import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import type { ReactElement } from "react";

vi.mock("../../src/api/eval", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/eval")>(
      "../../src/api/eval",
    );
  return {
    ...actual,
    createManualFixture: vi.fn(),
  };
});

import { EvalManualFixturePage } from "../../src/pages/EvalManualFixturePage";
import { createManualFixture, EvalApiError } from "../../src/api/eval";

const createManualFixtureMock = vi.mocked(createManualFixture);

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/admin/eval/fixtures/new"]}>
      <Routes>
        <Route
          path="/admin/eval/fixtures/new"
          element={<EvalFixtureWrapper />}
        />
        <Route
          path="/admin/eval/grade/:fixtureId"
          element={<div data-testid="grade-page">grade page</div>}
        />
      </Routes>
      <Toaster />
    </MemoryRouter>,
  );
}

function EvalFixtureWrapper(): ReactElement {
  return <EvalManualFixturePage />;
}

beforeEach(() => {
  createManualFixtureMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("EvalManualFixturePage", () => {
  it("renders form with textarea and submit", () => {
    renderPage();
    expect(screen.getByLabelText(/URLs/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /build fixture/i }),
    ).toBeTruthy();
  });

  it("submit is disabled when textarea is empty", () => {
    renderPage();
    const btn = screen.getByRole<HTMLButtonElement>("button", {
      name: /build fixture/i,
    });
    expect(btn.disabled).toBe(true);
  });

  it("shows error marker for an invalid URL line", () => {
    renderPage();
    const ta = screen.getByLabelText(/URLs/i);
    fireEvent.change(ta, { target: { value: "not-a-url\nhttps://ok.example/x" } });
    const invalid = screen.getByTestId("invalid-lines");
    expect(invalid.textContent).toMatch(/Line 1/);
    expect(invalid.textContent).toMatch(/invalid URL/);
    const btn = screen.getByRole<HTMLButtonElement>("button", {
      name: /build fixture/i,
    });
    expect(btn.disabled).toBe(true);
  });

  it("enables submit when at least one valid URL and no invalid lines", () => {
    renderPage();
    const ta = screen.getByLabelText(/URLs/i);
    fireEvent.change(ta, {
      target: { value: "https://example.com/a\nhttps://example.com/b\n" },
    });
    const btn = screen.getByRole<HTMLButtonElement>("button", {
      name: /build fixture/i,
    });
    expect(btn.disabled).toBe(false);
  });

  it("calls createManualFixture with valid URLs and navigates on success", async () => {
    createManualFixtureMock.mockResolvedValueOnce({
      fixtureId: "abc-123",
      itemCount: 2,
    });
    renderPage();
    const ta = screen.getByLabelText(/URLs/i);
    fireEvent.change(ta, {
      target: { value: "https://example.com/a\nhttps://example.com/b" },
    });
    fireEvent.click(screen.getByRole("button", { name: /build fixture/i }));
    await waitFor(() => {
      expect(createManualFixtureMock).toHaveBeenCalledWith(
        ["https://example.com/a", "https://example.com/b"],
        "",
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("grade-page")).toBeTruthy();
    });
  });

  it("passes optional fixture name when provided", async () => {
    createManualFixtureMock.mockResolvedValueOnce({
      fixtureId: "abc-123",
      itemCount: 1,
    });
    renderPage();
    fireEvent.change(screen.getByLabelText(/URLs/i), {
      target: { value: "https://example.com/a" },
    });
    fireEvent.change(screen.getByLabelText(/fixture name/i), {
      target: { value: "my-fix" },
    });
    fireEvent.click(screen.getByRole("button", { name: /build fixture/i }));
    await waitFor(() => {
      expect(createManualFixtureMock).toHaveBeenCalledWith(
        ["https://example.com/a"],
        "my-fix",
      );
    });
  });

  it("shows a toast on 422 response", async () => {
    createManualFixtureMock.mockRejectedValueOnce(
      new EvalApiError("invalid_body", 422, { error: "invalid_body" }),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText(/URLs/i), {
      target: { value: "https://example.com/a" },
    });
    fireEvent.click(screen.getByRole("button", { name: /build fixture/i }));
    await waitFor(() => {
      const toasts = document.querySelectorAll("[data-sonner-toast]");
      const text = Array.from(toasts)
        .map((t) => t.textContent ?? "")
        .join(" ");
      expect(text).toMatch(/invalid_body/);
    });
  });
});
