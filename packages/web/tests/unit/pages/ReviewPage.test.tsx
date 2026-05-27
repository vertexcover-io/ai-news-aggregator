import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, RouterProvider, createMemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import type { RankedItem } from "@newsletter/shared";
import { ReviewPage } from "../../../src/pages/ReviewPage";
import type { RunStateResponse } from "../../../src/api/runs";

vi.mock("../../../src/api/runs", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api/runs")>(
    "../../../src/api/runs",
  );
  return { ...actual, getAdminArchive: vi.fn() };
});

import { getAdminArchive } from "../../../src/api/runs";

vi.mock("../../../src/api/archives", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/api/archives")
  >("../../../src/api/archives");
  return { ...actual, patchArchive: vi.fn(), regenerateDigestMeta: vi.fn() };
});

import { patchArchive } from "../../../src/api/archives";

function fieldValue(label: string): string {
  const el = screen.getByLabelText(label);
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement
  ) {
    return el.value;
  }
  throw new Error(`expected an input/textarea for "${label}"`);
}

function makeItem(id: number, title: string): RankedItem {
  return {
    id,
    rawItemId: id,
    title,
    url: `https://example.com/${String(id)}`,
    sourceType: "hn",
    author: null,
    publishedAt: null,
    engagement: { points: 10, commentCount: 2 },
    score: 0.85,
    rationale: "because",
    content: null,
    imageUrl: null,
    recap: null,
    enrichedSource: null,
    sourceIdentifier: "news.ycombinator.com",
    preview: { kind: "none" },
  };
}

function renderAt(runId: string): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [{ path: "/review/:runId", element: <ReviewPage /> }],
    { initialEntries: [`/review/${runId}`] },
  );
  const tree: ReactElement = (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return render(tree);
}

beforeEach(() => {
  vi.mocked(getAdminArchive).mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReviewPage", () => {
  it("renders empty state with exact copy 'This run was not found.' on 404 (REQ-102)", async () => {
    vi.mocked(getAdminArchive).mockResolvedValue(null);
    renderAt("missing");
    await screen.findByText("This run was not found.");
    const link = screen.getByRole("link", { name: /back to dashboard/i });
    expect(link.getAttribute("href")).toBe("/admin");
  });

  it("renders in-progress message with exact copy for non-completed runs (REQ-103)", async () => {
    const running: RunStateResponse = {
      id: "run-1",
      status: "running",
      stage: "collecting",
      topN: 10,
      startedAt: "2026-04-14T00:00:00Z",
      updatedAt: "2026-04-14T00:00:00Z",
      completedAt: null,
      sources: {},
      rankedItems: null,
      shortlistedItemIds: null,
      warnings: [],
      error: null,
    };
    vi.mocked(getAdminArchive).mockResolvedValue(running);
    renderAt("run-1");
    await screen.findByText(
      "This run is still in progress — check back once it finishes.",
    );
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  describe("REQ-154: useBlocker intercepts in-app navigation when there are unsaved changes", () => {
    function makeCompletedResponse(): RunStateResponse {
      return {
        id: "run-1",
        status: "completed",
        stage: "completed",
        topN: 10,
        startedAt: "2026-04-14T00:00:00Z",
        updatedAt: "2026-04-14T00:00:00Z",
        completedAt: "2026-04-14T00:00:00Z",
        sources: {},
        rankedItems: [
          makeItem(1, "First"),
          makeItem(2, "Second"),
          makeItem(3, "Third"),
        ],
        shortlistedItemIds: null,
        warnings: [],
        error: null,
      };
    }

    function renderWithLink(): void {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      const router = createMemoryRouter(
        [
          {
            path: "/review/:runId",
            element: (
              <>
                <ReviewPage />
                <Link to="/elsewhere" data-testid="leave-link">
                  leave
                </Link>
              </>
            ),
          },
          { path: "/elsewhere", element: <div>elsewhere page</div> },
        ],
        { initialEntries: [`/review/run-1`] },
      );
      const tree: ReactElement = (
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      );
      render(tree);
    }

    it("blocks navigation when dirty and the user cancels confirmation", async () => {
      vi.mocked(getAdminArchive).mockResolvedValue(makeCompletedResponse());
      const confirmSpy = vi
        .spyOn(window, "confirm")
        .mockReturnValueOnce(false);

      renderWithLink();
      await screen.findByText("First");

      // Make the page dirty by deleting an item.
      const deleteButtons = await screen.findAllByRole("button", {
        name: /delete|remove/i,
      });
      const [firstDelete] = deleteButtons;
      act(() => {
        fireEvent.click(firstDelete);
      });

      // Click the in-app navigation link.
      const link = screen.getByTestId("leave-link");
      act(() => {
        fireEvent.click(link);
      });

      expect(confirmSpy).toHaveBeenCalled();
      // Cancelled — we are still on the review page (the leave link is still rendered).
      expect(screen.queryByText("elsewhere page")).toBeNull();
      expect(screen.queryByTestId("leave-link")).toBeTruthy();
    });

    it("does not prompt confirmation when not dirty (blocker returns false)", async () => {
      vi.mocked(getAdminArchive).mockResolvedValue(makeCompletedResponse());
      const confirmSpy = vi.spyOn(window, "confirm");

      renderWithLink();
      await screen.findByText("First");

      // Without dirtying state, the page should mount without ever invoking confirm.
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("registers a beforeunload listener", async () => {
      vi.mocked(getAdminArchive).mockResolvedValue(makeCompletedResponse());
      const addSpy = vi.spyOn(window, "addEventListener");
      const removeSpy = vi.spyOn(window, "removeEventListener");

      renderWithLink();
      await screen.findByText("First");

      const beforeUnloadAdds = addSpy.mock.calls.filter(
        (c) => c[0] === "beforeunload",
      );
      expect(beforeUnloadAdds.length).toBeGreaterThan(0);

      cleanup();
      const beforeUnloadRemoves = removeSpy.mock.calls.filter(
        (c) => c[0] === "beforeunload",
      );
      expect(beforeUnloadRemoves.length).toBeGreaterThan(0);
    });
  });

  it("renders cards in server order (REQ-101)", async () => {
    const response: RunStateResponse = {
      id: "run-1",
      status: "completed",
      stage: "completed",
      topN: 10,
      startedAt: "2026-04-14T00:00:00Z",
      updatedAt: "2026-04-14T00:00:00Z",
      completedAt: "2026-04-14T00:00:00Z",
      sources: {},
      rankedItems: [
        makeItem(1, "First Story"),
        makeItem(2, "Second Story"),
        makeItem(3, "Third Story"),
      ],
      shortlistedItemIds: null,
      warnings: [],
      error: null,
    };
    vi.mocked(getAdminArchive).mockResolvedValue(response);
    renderAt("run-1");
    const articles = await screen.findAllByRole("article");
    expect(articles).toHaveLength(3);
    // The title is now rendered as an editable field (not an <a>); the <a>
    // is the "open ↗" source link. Query the title via its text content.
    expect(articles[0].textContent).toContain("First Story");
    expect(articles[1].textContent).toContain("Second Story");
    expect(articles[2].textContent).toContain("Third Story");
  });

  it("renders DRY RUN pill when archive.isDryRun is true", async () => {
    const dry: RunStateResponse = {
      id: "run-dry",
      status: "completed",
      stage: "completed",
      topN: 10,
      startedAt: "2026-04-14T00:00:00Z",
      updatedAt: "2026-04-14T00:00:00Z",
      completedAt: "2026-04-14T00:00:00Z",
      sources: {},
      rankedItems: [makeItem(1, "T1")],
      shortlistedItemIds: null,
      warnings: [],
      error: null,
      isDryRun: true,
    };
    vi.mocked(getAdminArchive).mockResolvedValue(dry);
    renderAt("run-dry");
    const pill = await screen.findByTestId("dry-run-pill");
    expect(pill.textContent).toMatch(/dry run/i);
  });

  it("REQ-015: renders DigestMetaPanel below AddPostPanel, seeded from the archive digest fields", async () => {
    const response: RunStateResponse = {
      id: "run-1",
      status: "completed",
      stage: "completed",
      topN: 10,
      startedAt: "2026-04-14T00:00:00Z",
      updatedAt: "2026-04-14T00:00:00Z",
      completedAt: "2026-04-14T00:00:00Z",
      sources: {},
      rankedItems: [makeItem(1, "First")],
      shortlistedItemIds: null,
      warnings: [],
      error: null,
      digestHeadline: "Seeded headline",
      digestSummary: "Seeded summary",
      hook: "Seeded hook",
      twitterSummary: "Seeded twitter",
    };
    vi.mocked(getAdminArchive).mockResolvedValue(response);
    renderAt("run-1");
    await screen.findByText("First");

    const addPostLabel = screen.getByText("Add a post");
    const digestLabel = screen.getByText("Digest meta");
    // DOM order: Add a post precedes Digest meta
    expect(
      addPostLabel.compareDocumentPosition(digestLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(fieldValue("Headline")).toBe("Seeded headline");
    expect(fieldValue("Summary")).toBe("Seeded summary");
    expect(fieldValue("Hook")).toBe("Seeded hook");
    expect(fieldValue("Twitter Summary")).toBe("Seeded twitter");
  });

  it("REQ-019: Save includes the four digest fields with current panel values", async () => {
    const response: RunStateResponse = {
      id: "run-1",
      status: "completed",
      stage: "completed",
      topN: 10,
      startedAt: "2026-04-14T00:00:00Z",
      updatedAt: "2026-04-14T00:00:00Z",
      completedAt: "2026-04-14T00:00:00Z",
      sources: {},
      rankedItems: [makeItem(1, "First")],
      shortlistedItemIds: null,
      warnings: [],
      error: null,
      digestHeadline: "Seeded headline",
      digestSummary: "Seeded summary",
      hook: "Seeded hook",
      twitterSummary: "Seeded twitter",
    };
    vi.mocked(getAdminArchive).mockResolvedValue(response);
    vi.mocked(patchArchive).mockResolvedValue(undefined);
    renderAt("run-1");
    await screen.findByText("First");

    act(() => {
      fireEvent.change(screen.getByLabelText("Headline"), {
        target: { value: "Edited headline" },
      });
    });

    const saveButton = screen.getByRole("button", { name: /^save/i });
    act(() => {
      fireEvent.click(saveButton);
    });

    await vi.waitFor(() => {
      expect(vi.mocked(patchArchive)).toHaveBeenCalledTimes(1);
    });
    const body = vi.mocked(patchArchive).mock.calls[0]?.[1];
    expect(body).toMatchObject({
      digestHeadline: "Edited headline",
      digestSummary: "Seeded summary",
      hook: "Seeded hook",
      twitterSummary: "Seeded twitter",
    });
  });

  it("does not render DRY RUN pill when archive.isDryRun is false/undefined", async () => {
    const live: RunStateResponse = {
      id: "run-live",
      status: "completed",
      stage: "completed",
      topN: 10,
      startedAt: "2026-04-14T00:00:00Z",
      updatedAt: "2026-04-14T00:00:00Z",
      completedAt: "2026-04-14T00:00:00Z",
      sources: {},
      rankedItems: [makeItem(1, "T1")],
      shortlistedItemIds: null,
      warnings: [],
      error: null,
      isDryRun: false,
    };
    vi.mocked(getAdminArchive).mockResolvedValue(live);
    renderAt("run-live");
    await screen.findByRole("article");
    expect(screen.queryByTestId("dry-run-pill")).toBeNull();
  });
});
