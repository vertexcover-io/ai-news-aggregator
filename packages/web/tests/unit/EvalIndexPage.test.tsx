import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import type { ReactElement } from "react";

vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: vi.fn(),
}));
vi.mock("../../src/api/eval", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/eval")>(
      "../../src/api/eval",
    );
  return {
    ...actual,
    listEvalFixtures: vi.fn().mockResolvedValue({
      fixtures: [
        {
          fixtureId: "fx-1",
          source: "manual",
          date: null,
          model: "claude-haiku-4-5-20251001",
          exportedAt: "2026-05-01T00:00:00Z",
          itemCount: 5,
          gradingStatus: "graded",
        },
      ],
    }),
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
        {
          runId: "22222222-2222-4222-8222-222222222222",
          completedAt: "2026-05-22T12:30:00.000Z",
          createdAt: "2026-05-22T12:00:00.000Z",
          startedAt: "2026-05-22T12:01:00.000Z",
          itemCount: 1,
          topN: 1,
          digestHeadline: null,
          digestSummary: null,
          sourceTypes: ["reddit"],
        },
      ],
    }),
    saveDraftPrompt: vi.fn().mockResolvedValue({ ok: true }),
    runEval: vi.fn().mockReturnValue({
      progress: (async function* () {
        // empty
      })(),
      abort: () => undefined,
    }),
  };
});

import { EvalIndexPage } from "../../src/pages/EvalIndexPage";
import { useSettings } from "../../src/hooks/useSettings";
import { todayInTimezone } from "../../src/lib/dateSelectorTimezone";
import {
  listCalendarRuns,
  saveDraftPrompt,
  runEval,
  type EvalSseEvent,
} from "../../src/api/eval";

const useSettingsMock = vi.mocked(useSettings);
const listCalendarRunsMock = vi.mocked(listCalendarRuns);
const saveDraftPromptMock = vi.mocked(saveDraftPrompt);
const runEvalMock = vi.mocked(runEval);

interface SettingsLike {
  rankingPrompt: string;
  scheduleTimezone?: string | null;
}

function makeSettingsResult(data: SettingsLike | null): unknown {
  return {
    data,
    dataUpdatedAt: 1,
    isLoading: false,
    isError: false,
    isSuccess: data !== null,
    status: "success",
    refetch: vi.fn(),
  };
}

function renderPage(initial = "/admin/eval"): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper(): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/admin/eval" element={<EvalIndexPage />} />
          </Routes>
          <Toaster />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  render(<Wrapper />);
}

async function* streamEvents(
  events: readonly EvalSseEvent[],
): AsyncGenerator<EvalSseEvent> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}

beforeEach(() => {
  useSettingsMock.mockReturnValue(
    makeSettingsResult({
      rankingPrompt: "SAVED PROMPT",
      scheduleTimezone: "UTC",
    }) as ReturnType<
      typeof useSettings
    >,
  );
  saveDraftPromptMock.mockClear();
  listCalendarRunsMock.mockClear();
  runEvalMock.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("EvalIndexPage", () => {
  it("renders editor pre-filled with saved prompt", async () => {
    renderPage();
    const ta = await screen.findByTestId<HTMLTextAreaElement>(
      "prompt-editor-textarea",
    );
    await waitFor(() => {
      expect(ta.value).toBe("SAVED PROMPT");
    });
  });

  it("renders '+ New fixture' link pointing at the builder route", async () => {
    renderPage();
    const link = await screen.findByTestId<HTMLAnchorElement>(
      "new-fixture-link",
    );
    expect(link.getAttribute("href")).toBe("/admin/eval/fixtures/new");
    expect(link.textContent).toContain("New fixture");
  });

  it("renders Mode B panel via URL state", async () => {
    renderPage("/admin/eval?mode=ab");
    await screen.findByTestId("prompt-editor-textarea");
    expect(screen.getByTestId("ab-date")).toBeTruthy();
  });

  it("REQ-004: defaults Mode B date to today in the admin settings timezone", async () => {
    const timezone = "America/Adak";
    const expectedDate = todayInTimezone(timezone);
    useSettingsMock.mockReturnValue(
      makeSettingsResult({
        rankingPrompt: "SAVED PROMPT",
        scheduleTimezone: timezone,
      }) as ReturnType<typeof useSettings>,
    );

    renderPage("/admin/eval?mode=ab");
    const input = await screen.findByTestId<HTMLInputElement>("ab-date");

    await waitFor(() => {
      expect(input.value).toBe(expectedDate);
    });
    await waitFor(() => {
      expect(listCalendarRunsMock).toHaveBeenCalledWith(expectedDate);
    });
  });

  it("Mode B Run is disabled when draft equals saved", async () => {
    renderPage("/admin/eval?mode=ab");
    await screen.findByTestId("prompt-editor-textarea");
    const btn = screen.getByTestId<HTMLButtonElement>("run-mode-b");
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId("ab-hint")).toBeTruthy();
  });

  it("opens diff modal on Save and confirm triggers save", async () => {
    renderPage();
    const ta = await screen.findByTestId<HTMLTextAreaElement>(
      "prompt-editor-textarea",
    );
    fireEvent.change(ta, { target: { value: "DRAFT PROMPT" } });
    fireEvent.click(
      screen.getByRole("button", { name: /save as current prompt/i }),
    );
    const body = await screen.findByTestId("prompt-diff-body");
    expect(body).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(saveDraftPromptMock).toHaveBeenCalledWith("DRAFT PROMPT");
    });
  });

  it("Single-fixture mode sends fixtureId without windowSize", async () => {
    renderPage();
    await screen.findByTestId("prompt-editor-textarea");
    // wait for fixtures to load
    const select = await screen.findByTestId<HTMLSelectElement>(
      "fixture-select",
    );
    await waitFor(() => {
      expect(select.querySelectorAll("option").length).toBeGreaterThan(1);
    });
    fireEvent.change(select, { target: { value: "fx-1" } });
    fireEvent.click(screen.getByTestId("run-mode-a"));
    await waitFor(() => {
      expect(runEvalMock).toHaveBeenCalled();
    });
    const body = runEvalMock.mock.calls[0][0];
    expect(body.fixtureId).toBe("fx-1");
    expect("windowSize" in body).toBe(false);
  });

  it("REQ-001: removes Top-N controls from scored mode", async () => {
    renderPage();
    await screen.findByTestId("prompt-editor-textarea");

    expect(screen.queryByTestId("scope-topn")).toBeNull();
    expect(screen.queryByTestId("window-slider")).toBeNull();
    expect(screen.queryByText(/Top-N recent/i)).toBeNull();
  });

  it("REQ-001 REQ-002: completed scored rows open the per-fixture report", async () => {
    runEvalMock.mockReturnValueOnce({
      progress: streamEvents([
        {
          event: "progress",
          data: {
            fixtureId: "fx-1",
            status: "done",
            score: {
              fixtureId: "fx-1",
              ndcgAt10: 0.9,
              precisionAt10: 0.8,
              mustIncludeRecall: 1,
              rankOneIsMustInclude: true,
              perItemDiff: [],
              ranAt: "2026-05-22T00:00:00.000Z",
              promptHash: "hash",
              model: "model",
            },
            cost: {
              promptHash: "hash",
              tokensIn: 10,
              tokensOut: 5,
              usd: 0.001,
              cacheHit: false,
            },
            actualRanking: [
              {
                rawItemId: 1,
                url: "https://example.com/a",
                title: "Actual story",
                score: 0.95,
                rationale: "strong fit",
                summary: "Summary",
                bullets: [],
                bottomLine: "Bottom line",
              },
            ],
            expectedRanking: [
              {
                rawItemId: 1,
                url: "https://example.com/a",
                title: "Expected story",
                tier: "must",
                rank: 1,
              },
            ],
          },
        },
        { event: "done", data: { totalCost: { usd: 0.001 } } },
      ]),
      abort: () => undefined,
    });
    renderPage();
    await screen.findByTestId("prompt-editor-textarea");
    const select = await screen.findByTestId<HTMLSelectElement>(
      "fixture-select",
    );
    fireEvent.change(select, { target: { value: "fx-1" } });
    fireEvent.click(screen.getByTestId("run-mode-a"));

    const reportButton = await screen.findByRole("button", {
      name: /report for fx-1/i,
    });
    fireEvent.click(reportButton);

    expect(await screen.findByTestId("drawer-report-table")).toBeTruthy();
    expect(screen.getByText("Actual story")).toBeTruthy();
    expect(screen.getByText("Expected story")).toBeTruthy();
  });

  it("REQ-003 EDGE-002: rows without report payload do not show report actions", async () => {
    window.sessionStorage.setItem(
      "eval-run-state",
      JSON.stringify({
        version: 1,
        mode: "scored",
        scoredScope: "single",
        fixtureId: "fx-1",
        windowSize: 20,
        rows: [
          {
            fixtureId: "fx-1",
            status: "done",
            score: {
              ndcgAt10: 0.85,
              precisionAt10: 0.7,
              mustIncludeRecall: 1,
              rankOneIsMustInclude: true,
            },
            cost: { usd: 0.012, tokensIn: 100, tokensOut: 50 },
          },
          {
            fixtureId: "fx-2",
            status: "error",
            error: "boom",
          },
        ],
        totalUsd: 0.012,
        runError: null,
        persistedAt: Date.now(),
      }),
    );
    renderPage();
    await screen.findByTestId("prompt-editor-textarea");

    expect(screen.queryByRole("button", { name: /report for/i })).toBeNull();
  });

  it("Cancel in diff modal does not save", async () => {
    renderPage();
    const ta = await screen.findByTestId<HTMLTextAreaElement>(
      "prompt-editor-textarea",
    );
    fireEvent.change(ta, { target: { value: "DRAFT PROMPT" } });
    fireEvent.click(
      screen.getByRole("button", { name: /save as current prompt/i }),
    );
    await screen.findByTestId("prompt-diff-body");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.queryByTestId("prompt-diff-body")).toBeNull();
    });
    expect(saveDraftPromptMock).not.toHaveBeenCalled();
  });

  it("pre-selects fixture from ?fixtureId= URL param (REQ-1)", async () => {
    renderPage("/admin/eval?fixtureId=fx-1");
    const select = await screen.findByTestId<HTMLSelectElement>(
      "fixture-select",
    );
    await waitFor(() => {
      expect(select.querySelectorAll("option").length).toBeGreaterThan(1);
    });
    expect(select.value).toBe("fx-1");
  });

  it("REQ-004 REQ-006 REQ-008: calendar mode loads runs by date and submits selected run IDs", async () => {
    renderPage("/admin/eval?mode=ab");
    const ta = await screen.findByTestId<HTMLTextAreaElement>(
      "prompt-editor-textarea",
    );
    fireEvent.change(ta, { target: { value: "DRAFT PROMPT" } });
    const dateInput = screen.getByTestId<HTMLInputElement>("ab-date");
    fireEvent.change(dateInput, { target: { value: "2026-05-22" } });

    await screen.findByText("Morning digest");
    await waitFor(() => {
      expect(listCalendarRunsMock).toHaveBeenCalledWith("2026-05-22");
    });

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /select calendar run 11111111/i,
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /select calendar run 22222222/i,
      }),
    );
    fireEvent.click(screen.getByTestId("run-mode-b"));

    await waitFor(() => {
      expect(runEvalMock).toHaveBeenCalled();
    });
    const body = runEvalMock.mock.calls[0][0];
    expect(body).toMatchObject({
      mode: "ab",
      date: "2026-05-22",
      runIds: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ],
      draftPrompt: "DRAFT PROMPT",
    });
    expect("windowSize" in body).toBe(false);
    expect("forceWindow" in body).toBe(false);
  });

  it("REQ-009 REQ-010: calendar results open a previous-vs-draft report with prompt diff", async () => {
    runEvalMock.mockReturnValueOnce({
      progress: streamEvents([
        {
          event: "progress",
          data: {
            runId: "11111111-1111-4111-8111-111111111111",
            status: "done",
            previousRanking: [
              {
                rank: 1,
                rawItemId: 1,
                title: "Previous story",
                url: "https://example.com/previous",
                sourceType: "hn",
                score: 0.91,
                rationale: "previous rationale",
                summary: "previous summary",
                bullets: [],
                bottomLine: "previous bottom",
              },
            ],
            draftRanking: [
              {
                rank: 1,
                rawItemId: 2,
                title: "Draft story",
                url: "https://example.com/draft",
                sourceType: "github",
                score: 0.95,
                rationale: "draft rationale",
                summary: "draft summary",
                bullets: [],
                bottomLine: "draft bottom",
              },
            ],
            promptDiff: {
              savedPromptHash: "savedhash",
              draftPromptHash: "drafthash",
              savedPromptSnapshot: "SAVED PROMPT",
              draftPromptSnapshot: "DRAFT PROMPT",
            },
            cost: {
              promptHash: "drafthash",
              tokensIn: 10,
              tokensOut: 5,
              usd: 0.001,
              cacheHit: false,
            },
          },
        },
        {
          event: "aggregate",
          data: { calendarRuns: [], totalCost: { usd: 0.001 } },
        },
        { event: "done", data: { totalCost: { usd: 0.001 } } },
      ]),
      abort: () => undefined,
    });
    renderPage("/admin/eval?mode=ab");
    const ta = await screen.findByTestId<HTMLTextAreaElement>(
      "prompt-editor-textarea",
    );
    fireEvent.change(ta, { target: { value: "DRAFT PROMPT" } });
    await screen.findByText("Morning digest");
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /select calendar run 11111111/i,
      }),
    );
    fireEvent.click(screen.getByTestId("run-mode-b"));

    const reportButton = await screen.findByRole("button", {
      name: /report for calendar run 11111111/i,
    });
    fireEvent.click(reportButton);

    const dialog = await screen.findByTestId("calendar-report-dialog");
    expect(within(dialog).getByTestId("calendar-report-layout")).toBeTruthy();
    expect(
      within(dialog).getByTestId("calendar-report-previous-ranking"),
    ).toBeTruthy();
    expect(within(dialog).getByTestId("calendar-report-draft-ranking")).toBeTruthy();
    expect(within(dialog).getByTestId("calendar-report-saved-prompt")).toBeTruthy();
    expect(within(dialog).getByTestId("calendar-report-draft-prompt")).toBeTruthy();
    expect(within(dialog).getByText("Previous story")).toBeTruthy();
    expect(within(dialog).getByText("Draft story")).toBeTruthy();
    expect(within(dialog).getByText("SAVED PROMPT")).toBeTruthy();
    expect(within(dialog).getByText("DRAFT PROMPT")).toBeTruthy();
    expect(
      within(dialog).getByTestId("calendar-report-title-previous-1").className,
    ).not.toContain("truncate");
  });

  it("hydrates Mode A rows from sessionStorage on mount (REQ-2)", async () => {
    window.sessionStorage.setItem(
      "eval-run-state",
      JSON.stringify({
        version: 1,
        mode: "scored",
        scoredScope: "single",
        fixtureId: "fx-1",
        windowSize: 20,
        rows: [
          {
            fixtureId: "fx-1",
            status: "done",
            score: {
              ndcgAt10: 0.85,
              precisionAt10: 0.7,
              mustIncludeRecall: 1,
              rankOneIsMustInclude: true,
            },
            cost: { usd: 0.012, tokensIn: 100, tokensOut: 50 },
            error: undefined,
          },
        ],
        totalUsd: 0.012,
        runError: null,
        persistedAt: Date.now(),
      }),
    );
    renderPage();
    await screen.findByTestId("prompt-editor-textarea");
    // EvalResultsPanel renders the per-fixture row when hydrated.
    await waitFor(() => {
      expect(screen.queryAllByText(/fx-1/).length).toBeGreaterThan(0);
    });
  });

  it("aggregate hero is absent with empty rows and visible after hydration (REQ-5)", async () => {
    // empty rows on initial mount → no hero
    renderPage();
    await screen.findByTestId("prompt-editor-textarea");
    expect(screen.queryByTestId("eval-aggregate-hero")).toBeNull();
    cleanup();

    // seed sessionStorage with completed rows → hero renders
    window.sessionStorage.setItem(
      "eval-run-state",
      JSON.stringify({
        version: 1,
        mode: "scored",
        scoredScope: "single",
        fixtureId: "fx-1",
        windowSize: 20,
        rows: [
          {
            fixtureId: "fx-1",
            status: "done",
            score: {
              ndcgAt10: 0.85,
              precisionAt10: 0.7,
              mustIncludeRecall: 1,
              rankOneIsMustInclude: true,
            },
            cost: { usd: 0.012, tokensIn: 100, tokensOut: 50 },
            error: undefined,
          },
        ],
        totalUsd: 0.012,
        runError: null,
        persistedAt: Date.now(),
      }),
    );
    renderPage();
    await screen.findByTestId("prompt-editor-textarea");
    await waitFor(() => {
      expect(screen.getByTestId("eval-aggregate-hero")).toBeTruthy();
    });
  });

  it("discards persisted run state older than 1 hour (EDGE-2.2)", async () => {
    window.sessionStorage.setItem(
      "eval-run-state",
      JSON.stringify({
        version: 1,
        mode: "scored",
        scoredScope: "single",
        fixtureId: "fx-1",
        windowSize: 20,
        rows: [
          {
            fixtureId: "fx-1",
            status: "done",
            score: {
              ndcgAt10: 0.85,
              precisionAt10: 0.7,
              mustIncludeRecall: 1,
              rankOneIsMustInclude: true,
            },
            cost: { usd: 0.012, tokensIn: 100, tokensOut: 50 },
            error: undefined,
          },
        ],
        totalUsd: 0.012,
        runError: null,
        persistedAt: Date.now() - 2 * 60 * 60 * 1000,
      }),
    );
    renderPage();
    await screen.findByTestId("prompt-editor-textarea");
    // Stale record should be cleared; sessionStorage key gone.
    await waitFor(() => {
      expect(window.sessionStorage.getItem("eval-run-state")).toBeNull();
    });
  });

  it("REQ-009: calendar run list row renders itemCount (deduped pool size) from the API", async () => {
    // The mock returns: run 1 with itemCount=2, topN=2; run 2 with itemCount=1, topN=1.
    // After Phase 3, itemCount == deduped pool size (not topN). The row must render
    // "{itemCount} items · top {topN}" verbatim from the API values.
    renderPage("/admin/eval?mode=ab");
    await screen.findByTestId("prompt-editor-textarea");
    const dateInput = screen.getByTestId<HTMLInputElement>("ab-date");
    const { fireEvent: fe } = await import("@testing-library/react");
    fe.change(dateInput, { target: { value: "2026-05-22" } });

    // Wait for both run rows to appear
    await screen.findByText("Morning digest");

    // Run 1: itemCount=2, topN=2 → "2 items · top 2"
    const run1Label = screen.getByRole("checkbox", {
      name: /select calendar run 11111111/i,
    }).closest("label");
    expect(run1Label?.textContent).toContain("2 items");
    expect(run1Label?.textContent).toContain("top 2");

    // Run 2: itemCount=1, topN=1 → "1 items · top 1"
    const run2Label = screen.getByRole("checkbox", {
      name: /select calendar run 22222222/i,
    }).closest("label");
    expect(run2Label?.textContent).toContain("1 items");
    expect(run2Label?.textContent).toContain("top 1");
  });
});
