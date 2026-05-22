import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { EvalRun } from "@newsletter/shared/types/eval-ranking";

vi.mock("../../src/api/eval", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/eval")>(
      "../../src/api/eval",
    );
  return {
    ...actual,
    getEvalRun: vi.fn(),
  };
});

import { ComparePromptsDialog } from "../../src/components/eval/ComparePromptsDialog";
import { getEvalRun, EvalApiError } from "../../src/api/eval";

const getEvalRunMock = vi.mocked(getEvalRun);

function makeRun(id: string, overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    id,
    mode: "scored",
    fixtureId: "fx-1",
    date: null,
    windowSize: null,
    draftPromptHash: `hash-${id}`,
    draftPromptSnapshot: `Prompt for ${id}\nLine 2\nLine 3`,
    savedPromptHash: null,
    savedPromptSnapshot: null,
    status: "done",
    startedAt: "2026-05-21T19:14:08.000Z",
    finishedAt: "2026-05-21T19:14:30.000Z",
    scoreBreakdown: { ndcgAt10: 0.8 },
    costBreakdown: null,
    errorMessage: null,
    ...overrides,
  };
}

function renderDialog(
  runIds: [string, string] | null = ["aaa111", "bbb222"],
): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper(): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <ComparePromptsDialog runIds={runIds} onClose={vi.fn()} />
      </QueryClientProvider>
    );
  }
  render(<Wrapper />);
}

beforeEach(() => {
  getEvalRunMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ComparePromptsDialog", () => {
  it("fires two parallel getEvalRun calls when runIds is set", async () => {
    getEvalRunMock.mockImplementation((id: string) =>
      Promise.resolve(makeRun(id)),
    );
    renderDialog(["aaa111", "bbb222"]);
    await waitFor(() => {
      expect(getEvalRunMock).toHaveBeenCalledWith("aaa111");
      expect(getEvalRunMock).toHaveBeenCalledWith("bbb222");
    });
    expect(getEvalRunMock).toHaveBeenCalledTimes(2);
  });

  it("renders 'No changes' when both prompts are identical (EDGE-3.1)", async () => {
    getEvalRunMock.mockImplementation((id: string) =>
      Promise.resolve(
        makeRun(id, {
          draftPromptHash: "same-hash",
          draftPromptSnapshot: "same content",
          scoreBreakdown: { ndcgAt10: 0.5 },
        }),
      ),
    );
    renderDialog(["aaa111", "bbb222"]);
    await screen.findByTestId("compare-no-changes");
    // Score delta still rendered.
    expect(screen.getByTestId("compare-score-delta")).toBeTruthy();
  });

  it("renders error banner + successful side when one fetch fails (EDGE-3.2)", async () => {
    getEvalRunMock.mockImplementation((id: string) => {
      if (id === "aaa111") {
        return Promise.reject(new EvalApiError("not found", 404));
      }
      return Promise.resolve(makeRun(id));
    });
    renderDialog(["aaa111", "bbb222"]);
    await screen.findByTestId("compare-error-banner");
    expect(
      screen.getByTestId("compare-error-banner").textContent,
    ).toContain("Left side");
    await screen.findByTestId("compare-snapshot-b");
  });
});
