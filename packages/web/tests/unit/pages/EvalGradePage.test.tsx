import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import type {
  Fixture,
  FixtureItem,
} from "@newsletter/shared/types/eval-ranking";
import { EvalGradePage } from "../../../src/pages/EvalGradePage";

vi.mock("../../../src/api/eval", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api/eval")>(
    "../../../src/api/eval",
  );
  return {
    ...actual,
    getEvalFixture: vi.fn(),
    saveGroundTruth: vi.fn(),
    saveGroundTruthToRepo: vi.fn(),
  };
});

import {
  getEvalFixture,
  saveGroundTruth,
} from "../../../src/api/eval";

function makeItem(id: number, title: string): FixtureItem {
  return {
    rawItemId: id,
    title,
    url: `https://example.com/${String(id)}`,
    sourceType: "hn",
    publishedAt: "2026-05-20T00:00:00Z",
    content: null,
    enrichedLink: {
      url: `https://example.com/${String(id)}`,
      fetchedAt: "2026-05-20T00:00:00Z",
      status: "ok",
      description: `description for ${title}`,
    },
    enrichmentStatus: "ok",
    comments: [],
    engagement: { points: 10 + id, commentCount: 1 },
  };
}

function makeFixture(): Fixture {
  return {
    fixtureId: "fx-test",
    source: "manual",
    date: "2026-05-22",
    runId: null,
    model: "claude-haiku-4-5-20251001",
    exportedAt: "2026-05-22T00:00:00Z",
    pool: [makeItem(1, "First"), makeItem(2, "Second"), makeItem(3, "Third")],
    dedupClusters: [],
    originalRankerOutput: null,
  };
}

function renderPage(fixtureId = "fx-test"): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [{ path: "/admin/eval/grade/:fixtureId", element: <EvalGradePage /> }],
    { initialEntries: [`/admin/eval/grade/${fixtureId}`] },
  );
  const tree: ReactElement = (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return render(tree);
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("eval-grader-name", "aman");
  vi.mocked(getEvalFixture).mockReset();
  vi.mocked(saveGroundTruth).mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EvalGradePage", () => {
  it("renders cluster list from the fixture", async () => {
    vi.mocked(getEvalFixture).mockResolvedValue({
      fixture: makeFixture(),
      groundTruth: null,
    });
    renderPage();
    await screen.findByText("First");
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.getByText("Third")).toBeTruthy();
  });

  it("pressing 1 labels the first cluster as 'must'", async () => {
    vi.mocked(getEvalFixture).mockResolvedValue({
      fixture: makeFixture(),
      groundTruth: null,
    });
    renderPage();
    await screen.findByText("First");
    act(() => {
      fireEvent.keyDown(window, { key: "1" });
    });
    const chip = await screen.findByTestId("label-chip-1");
    expect(chip.textContent?.toLowerCase()).toContain("must");
  });

  it("pressing space expands the description of the selected cluster", async () => {
    vi.mocked(getEvalFixture).mockResolvedValue({
      fixture: makeFixture(),
      groundTruth: null,
    });
    renderPage();
    await screen.findByText("First");
    expect(screen.queryByTestId("description-1")).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: " " });
    });
    const desc = await screen.findByTestId("description-1");
    expect(desc.textContent).toContain("description for First");
  });

  it("pressing ArrowDown advances the selection", async () => {
    vi.mocked(getEvalFixture).mockResolvedValue({
      fixture: makeFixture(),
      groundTruth: null,
    });
    renderPage();
    await screen.findByText("First");
    const firstRow = screen.getByTestId("cluster-row-1");
    expect(firstRow.getAttribute("data-selected")).toBe("true");
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowDown" });
    });
    const secondRow = screen.getByTestId("cluster-row-2");
    expect(secondRow.getAttribute("data-selected")).toBe("true");
    expect(firstRow.getAttribute("data-selected")).toBe("false");
  });

  it("export button disabled until all clusters labeled, then enabled and triggers download", async () => {
    vi.mocked(getEvalFixture).mockResolvedValue({
      fixture: makeFixture(),
      groundTruth: null,
    });
    vi.mocked(saveGroundTruth).mockResolvedValue({
      fixtureId: "fx-test",
      gradedBy: ["aman"],
      gradedAt: "2026-05-22T00:00:00Z",
      labels: [],
    });
    const createObjectURL = vi.fn().mockReturnValue("blob:fake");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    renderPage();
    await screen.findByText("First");
    const exportBtn = screen.getByTestId("export-button");
    expect(exportBtn.hasAttribute("disabled")).toBe(true);

    act(() => {
      fireEvent.keyDown(window, { key: "1" });
    });
    act(() => {
      fireEvent.keyDown(window, { key: "2" });
    });
    act(() => {
      fireEvent.keyDown(window, { key: "3" });
    });

    expect(exportBtn.hasAttribute("disabled")).toBe(false);

    act(() => {
      fireEvent.click(exportBtn);
    });
    // Allow the async save to settle.
    await screen.findByTestId("export-button");

    expect(saveGroundTruth).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it("prompts for grader name when none is stored", () => {
    window.localStorage.removeItem("eval-grader-name");
    vi.mocked(getEvalFixture).mockResolvedValue({
      fixture: makeFixture(),
      groundTruth: null,
    });
    renderPage();
    expect(screen.getByTestId("grader-prompt")).toBeTruthy();
  });
});
