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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

vi.mock("../../src/api/eval", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/eval")>(
      "../../src/api/eval",
    );
  return {
    ...actual,
    createManualFixture: vi.fn(),
    listCalendarRuns: vi.fn().mockResolvedValue({
      date: "2026-05-22",
      runs: [
        {
          runId: "11111111-1111-4111-8111-111111111111",
          completedAt: "2026-05-22T08:30:00.000Z",
          createdAt: "2026-05-22T08:00:00.000Z",
          startedAt: "2026-05-22T08:01:00.000Z",
          itemCount: 2,
          topN: 2,
          digestHeadline: "Morning digest",
          digestSummary: "Two strong candidates",
          sourceTypes: ["hn", "github"],
        },
      ],
    }),
    getCalendarRunDetail: vi.fn().mockResolvedValue({
      runId: "11111111-1111-4111-8111-111111111111",
      completedAt: "2026-05-22T08:30:00.000Z",
      createdAt: "2026-05-22T08:00:00.000Z",
      startedAt: "2026-05-22T08:01:00.000Z",
      itemCount: 2,
      topN: 2,
      digestHeadline: "Morning digest",
      digestSummary: "Two strong candidates",
      sourceTypes: ["hn", "github"],
      previousRanking: [
        {
          rank: 1,
          rawItemId: 1,
          title: "Ranked item A",
          url: "https://example.com/a",
          sourceType: "hn",
          score: 0.91,
          rationale: "strong",
          summary: "summary",
          bullets: [],
          bottomLine: "bottom",
        },
        {
          rank: 2,
          rawItemId: 2,
          title: "Ranked item B",
          url: "https://example.com/b",
          sourceType: "github",
          score: 0.88,
          rationale: "useful",
          summary: "summary",
          bullets: [],
          bottomLine: "bottom",
        },
      ],
      sourcePool: [
        {
          rawItemId: 1,
          title: "Ranked item A",
          url: "https://example.com/a",
          sourceType: "hn",
          publishedAt: null,
          content: null,
          enrichedLink: null,
          enrichmentStatus: "ok",
          comments: [],
          engagement: null,
        },
        {
          rawItemId: 2,
          title: "Ranked item B",
          url: "https://example.com/b",
          sourceType: "github",
          publishedAt: null,
          content: null,
          enrichedLink: null,
          enrichmentStatus: "ok",
          comments: [],
          engagement: null,
        },
      ],
    }),
  };
});

import { EvalManualFixturePage } from "../../src/pages/EvalManualFixturePage";
import {
  createManualFixture,
  EvalApiError,
  getCalendarRunDetail,
  listCalendarRuns,
} from "../../src/api/eval";

const createManualFixtureMock = vi.mocked(createManualFixture);
const listCalendarRunsMock = vi.mocked(listCalendarRuns);
const getCalendarRunDetailMock = vi.mocked(getCalendarRunDetail);

function renderPage(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/eval/fixtures/new"]}>
        <Routes>
          <Route
            path="/admin/eval/fixtures/new"
            element={<EvalFixtureWrapper />}
          />
          <Route
            path="/admin/eval/grade/:fixtureId"
            element={<div data-testid="grade-page-landed">grade page</div>}
          />
        </Routes>
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function EvalFixtureWrapper(): ReactElement {
  return <EvalManualFixturePage />;
}

beforeEach(() => {
  createManualFixtureMock.mockReset();
  listCalendarRunsMock.mockClear();
  getCalendarRunDetailMock.mockClear();
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
      expect(screen.getByTestId("grade-page-landed")).toBeTruthy();
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

  it("REQ-013 REQ-014 REQ-015: selecting a date lists runs and opens ranked item sources", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/import from date/i), {
      target: { value: "2026-05-22" },
    });
    await waitFor(() => {
      expect(listCalendarRunsMock).toHaveBeenCalledWith("2026-05-22");
    });
    fireEvent.click(await screen.findByRole("button", { name: /Morning digest/i }));

    expect(getCalendarRunDetailMock).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(await screen.findByTestId("calendar-source-dialog")).toBeTruthy();
    expect(screen.getByText("Ranked item A")).toBeTruthy();
    expect(screen.getByText("https://example.com/a")).toBeTruthy();
    expect(screen.getByText("hn")).toBeTruthy();
  });

  it("REQ-016 REQ-017: imports calendar sources one by one and all at once", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/import from date/i), {
      target: { value: "2026-05-22" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Morning digest/i }));
    await screen.findByTestId("calendar-source-dialog");

    fireEvent.click(screen.getByRole("button", { name: /import source 1/i }));
    expect(screen.getByLabelText<HTMLTextAreaElement>(/URLs/i).value).toBe(
      "https://example.com/a",
    );

    fireEvent.click(screen.getByRole("button", { name: /import all sources/i }));
    expect(screen.getByLabelText<HTMLTextAreaElement>(/URLs/i).value).toBe(
      "https://example.com/a\nhttps://example.com/b",
    );
  });

  it("REQ-016 REQ-017 EDGE-010: imports source pool URLs and submits imported sources", async () => {
    getCalendarRunDetailMock.mockResolvedValueOnce({
      runId: "11111111-1111-4111-8111-111111111111",
      completedAt: "2026-05-22T08:30:00.000Z",
      createdAt: "2026-05-22T08:00:00.000Z",
      startedAt: "2026-05-22T08:01:00.000Z",
      itemCount: 2,
      topN: 2,
      digestHeadline: "Morning digest",
      digestSummary: "Two strong candidates",
      sourceTypes: ["hn", "github"],
      previousRanking: [
        {
          rank: 1,
          rawItemId: 1,
          title: "Ranked item A",
          url: "https://display.example/a",
          sourceType: "hn",
          score: 0.91,
          rationale: "strong",
          summary: "summary",
          bullets: [],
          bottomLine: "bottom",
        },
        {
          rank: 2,
          rawItemId: 2,
          title: "Ranked item B",
          url: "https://display.example/b",
          sourceType: "github",
          score: 0.88,
          rationale: "useful",
          summary: "summary",
          bullets: [],
          bottomLine: "bottom",
        },
      ],
      sourcePool: [
        {
          rawItemId: 1,
          title: "Source item A",
          url: "https://source.example/a",
          sourceType: "hn",
          publishedAt: null,
          content: null,
          enrichedLink: null,
          enrichmentStatus: "ok",
          comments: [],
          engagement: null,
        },
      ],
    });
    createManualFixtureMock.mockResolvedValueOnce({
      fixtureId: "abc-123",
      itemCount: 1,
    });

    renderPage();
    fireEvent.change(screen.getByLabelText(/import from date/i), {
      target: { value: "2026-05-22" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Morning digest/i }));
    await screen.findByTestId("calendar-source-dialog");

    fireEvent.click(screen.getByRole("button", { name: /import source 1/i }));
    expect(screen.getByLabelText<HTMLTextAreaElement>(/URLs/i).value).toBe(
      "https://source.example/a",
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /import source 2/i })
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    fireEvent.click(screen.getByRole("button", { name: /build fixture/i }));
    await waitFor(() => {
      expect(createManualFixtureMock).toHaveBeenCalledWith(
        ["https://source.example/a"],
        "",
      );
    });
  });
});
