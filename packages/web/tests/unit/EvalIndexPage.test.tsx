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
import { saveDraftPrompt, runEval } from "../../src/api/eval";

const useSettingsMock = vi.mocked(useSettings);
const saveDraftPromptMock = vi.mocked(saveDraftPrompt);
const runEvalMock = vi.mocked(runEval);

interface SettingsLike {
  rankingPrompt: string;
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

beforeEach(() => {
  useSettingsMock.mockReturnValue(
    makeSettingsResult({ rankingPrompt: "SAVED PROMPT" }) as ReturnType<
      typeof useSettings
    >,
  );
  saveDraftPromptMock.mockClear();
  runEvalMock.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
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
    expect(body.windowSize).toBeUndefined();
  });

  it("Top-N mode sends windowSize without fixtureId", async () => {
    renderPage();
    await screen.findByTestId("prompt-editor-textarea");
    fireEvent.click(screen.getByTestId("scope-topn"));
    const slider = screen.getByTestId<HTMLInputElement>("window-slider");
    fireEvent.change(slider, { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("run-mode-a"));
    await waitFor(() => {
      expect(runEvalMock).toHaveBeenCalled();
    });
    const body = runEvalMock.mock.calls[0][0];
    expect(body.windowSize).toBe(5);
    expect(body.fixtureId).toBeUndefined();
    expect(body.forceWindow).toBeUndefined();
  });

  it("Top-N with windowSize beyond cap opens cost modal; confirm sends forceWindow", async () => {
    renderPage();
    await screen.findByTestId("prompt-editor-textarea");
    fireEvent.click(screen.getByTestId("scope-topn"));
    const slider = screen.getByTestId<HTMLInputElement>("window-slider");
    // jsdom clamps `input[type=range]` to its `max` when the value is
    // assigned. Stub the descriptor so the value passes through unchanged so
    // we can drive windowSize past the cap and exercise the cost-confirm
    // modal.
    Object.defineProperty(slider, "value", {
      configurable: true,
      get(): string {
        return "65";
      },
      set() {
        /* swallow */
      },
    });
    fireEvent.change(slider);
    fireEvent.click(screen.getByTestId("run-mode-a"));
    await screen.findByTestId("cost-confirm-modal");
    expect(runEvalMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("cost-confirm-proceed"));
    await waitFor(() => {
      expect(runEvalMock).toHaveBeenCalled();
    });
    const body = runEvalMock.mock.calls[0][0];
    expect(body.windowSize).toBe(65);
    expect(body.forceWindow).toBe(true);
    expect(body.fixtureId).toBeUndefined();
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
});
