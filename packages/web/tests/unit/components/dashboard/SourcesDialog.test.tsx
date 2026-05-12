import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { RunSourcesResponse, RawItemSummary } from "@newsletter/shared";

vi.mock("../../../../src/api/runs", () => ({
  getRunSources: vi.fn(),
}));

import { getRunSources } from "../../../../src/api/runs";
import { SourcesDialog } from "../../../../src/components/dashboard/SourcesDialog";

afterEach(() => {
  cleanup();
  vi.mocked(getRunSources).mockReset();
});

function makeItem(overrides: Partial<RawItemSummary>): RawItemSummary {
  return {
    id: 1,
    sourceType: "hn",
    title: "Item title",
    url: "https://example.com/item",
    author: "alice",
    imageUrl: null,
    publishedAt: "2026-05-12T00:00:00Z",
    collectedAt: "2026-05-12T00:00:00Z",
    engagement: { points: 10, commentCount: 5 },
    ...overrides,
  };
}

function renderDialog(
  props: Partial<Parameters<typeof SourcesDialog>[0]> = {},
): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const onOpenChange = props.onOpenChange ?? vi.fn();
  return (
    <QueryClientProvider client={client}>
      <SourcesDialog
        open={props.open ?? true}
        onOpenChange={onOpenChange}
        runId={props.runId === undefined ? "run-1" : props.runId}
        runStartedAt={props.runStartedAt}
      />
    </QueryClientProvider>
  );
}

describe("SourcesDialog", () => {
  it("REQ-017: renders skeleton rows while pending", () => {
    vi.mocked(getRunSources).mockImplementation(
      () => new Promise<RunSourcesResponse>(() => undefined),
    );
    render(renderDialog());
    expect(screen.getAllByTestId("source-skeleton").length).toBeGreaterThan(0);
  });

  it("REQ-013/REQ-014: groups items by source with headers and counts", async () => {
    const items: RawItemSummary[] = [
      makeItem({ id: 1, sourceType: "hn", title: "HN one" }),
      makeItem({ id: 2, sourceType: "hn", title: "HN two" }),
      makeItem({ id: 3, sourceType: "reddit", title: "Reddit one" }),
      makeItem({ id: 4, sourceType: "blog", title: "Blog one" }),
    ];
    vi.mocked(getRunSources).mockResolvedValue({ runId: "run-1", items });
    render(renderDialog());
    await waitFor(() => {
      expect(screen.getByText(/HN · 2 items/)).toBeTruthy();
    });
    expect(screen.getByText(/Reddit · 1 items/)).toBeTruthy();
    expect(screen.getByText(/Blog · 1 items/)).toBeTruthy();
  });

  it("REQ-015: title anchor has correct href, target, rel", async () => {
    vi.mocked(getRunSources).mockResolvedValue({
      runId: "run-1",
      items: [makeItem({ url: "https://example.com/post", title: "A post" })],
    });
    render(renderDialog());
    const link = await screen.findByRole("link", { name: "A post" });
    expect(link.getAttribute("href")).toBe("https://example.com/post");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
  });

  it("REQ-019: renders empty-state copy when items=[]", async () => {
    vi.mocked(getRunSources).mockResolvedValue({ runId: "run-1", items: [] });
    render(renderDialog());
    await waitFor(() => {
      expect(
        screen.getByText("No raw items collected for this run."),
      ).toBeTruthy();
    });
  });

  it("REQ-018: renders error state + Retry button that refetches", async () => {
    vi.mocked(getRunSources)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ runId: "run-1", items: [] });
    render(renderDialog());
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(retry).toBeTruthy();
    fireEvent.click(retry);
    await waitFor(() => {
      expect(vi.mocked(getRunSources).mock.calls.length).toBeGreaterThanOrEqual(
        2,
      );
    });
  });

  it("REQ-020: dismiss via Esc invokes onOpenChange(false)", async () => {
    const onOpenChange = vi.fn();
    vi.mocked(getRunSources).mockResolvedValue({ runId: "run-1", items: [] });
    render(renderDialog({ onOpenChange }));
    await screen.findByText("No raw items collected for this run.");
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("renders nothing for the body when runId is null", () => {
    render(renderDialog({ runId: null }));
    expect(vi.mocked(getRunSources)).not.toHaveBeenCalled();
  });
});
