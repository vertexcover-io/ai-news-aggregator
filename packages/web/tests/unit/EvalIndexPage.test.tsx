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
import { saveDraftPrompt } from "../../src/api/eval";

const useSettingsMock = vi.mocked(useSettings);
const saveDraftPromptMock = vi.mocked(saveDraftPrompt);

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
});

afterEach(() => {
  cleanup();
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
});
