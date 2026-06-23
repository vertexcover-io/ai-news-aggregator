import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RunLogEntry,
  RunObservabilitySource,
  RunSourceItem,
  RunSourceItemsResponse,
} from "@newsletter/shared/types";
import { SourceItemsPanel } from "../../../../src/components/observability/SourceItemsPanel";
import { SourceTelemetryTable } from "../../../../src/components/observability/SourceTelemetryTable";

vi.mock("../../../../src/api/runs", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/api/runs")>(
    "../../../../src/api/runs",
  );
  return {
    ...actual,
    getRunSourceItems: vi.fn(),
  };
});

import { getRunSourceItems } from "../../../../src/api/runs";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.mocked(getRunSourceItems).mockReset();
});

function makeWrapper(): (props: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const source: RunObservabilitySource = {
  sourceType: "reddit",
  identifier: "r/AI_Agents",
  displayName: "r/AI_Agents",
  itemsFetched: 50,
  status: "completed",
  errors: [],
  retries: 0,
  durationMs: 1700,
};

function makeLog(overrides: Partial<RunLogEntry>): RunLogEntry {
  return {
    id: 1,
    runId: "run-1",
    ts: "2026-05-27T08:00:01Z",
    level: "info",
    stage: "collecting",
    source: "reddit:r/AI_Agents",
    event: "source.completed",
    message: "source completed",
    context: { fetched: 50 },
    ...overrides,
  };
}

function makeItem(overrides: Partial<RunSourceItem>): RunSourceItem {
  return {
    id: 101,
    title: "OpenAI ships agent SDK with built-in tool routing",
    url: "https://example.com/agent-sdk",
    author: "u/devshipper",
    engagement: { points: 412, commentCount: 88 },
    publishedAt: "2026-05-27T04:00:00Z",
    sourceIdentifier: "r/AI_Agents",
    lifecycle: {
      fetched: true,
      enrich: { status: "ok", reason: null },
      dedup: { status: "survived", winnerTitle: null, winnerId: null, winnerPoints: null },
      shortlisted: true,
      rank: 1,
    },
    furthestStage: "ranked",
    dropReason: null,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<RunSourceItemsResponse>): RunSourceItemsResponse {
  return {
    runId: "run-1",
    sourceKey: "reddit:r/AI_Agents",
    live: false,
    summary: {
      ranked: 1,
      shortlisted: 0,
      dedupedSurvivors: 38,
      dedupDropped: 1,
      enrichFailed: 1,
    },
    steps: [],
    items: [
      makeItem({}),
      makeItem({
        id: 102,
        title: "Show HN: I built an open-source agent SDK clone",
        url: "https://example.com/agent-sdk-copy",
        author: "u/clonemaker",
        engagement: { points: 47, commentCount: 12 },
        lifecycle: {
          fetched: true,
          enrich: { status: "ok", reason: null },
          dedup: {
            status: "dropped",
            winnerTitle: "OpenAI ships agent SDK",
            winnerId: 101,
            winnerPoints: 412,
          },
          shortlisted: false,
          rank: null,
        },
        furthestStage: "dedup-dropped",
        dropReason:
          "dedup-dropped · duplicate URL, lost to \"OpenAI ships agent SDK\" (412 vs 47 pts)",
      }),
    ],
    logs: [
      makeLog({ id: 1, event: "source.completed", message: "collect.ok" }),
      makeLog({
        id: 2,
        level: "warn",
        event: "enrichment.summary",
        message: "enrich.failed",
        context: { reason: "timeout" },
      }),
    ],
    ...overrides,
  };
}

describe("SourceItemsPanel", () => {
  it("REQ-004, REQ-005, REQ-007, REQ-010, REQ-012: renders pills, flat item rows, one reason, and hidden-scroll log strip", async () => {
    vi.mocked(getRunSourceItems).mockResolvedValue(makeResponse({}));

    render(
      <SourceItemsPanel runId="run-1" source={source} sourceKey="reddit:r/AI_Agents" />,
      { wrapper: makeWrapper() },
    );

    await screen.findByRole("link", {
      name: /OpenAI ships agent SDK with built-in tool routing/i,
    });
    const panel = screen.getByTestId("source-items-panel");
    expect(panel.textContent).toContain("1 ranked");
    expect(panel.textContent).not.toContain("0 shortlisted");
    expect(panel.textContent).toContain("38 deduped-survivors");
    expect(panel.textContent).toContain("1 dedup-dropped");

    const link = screen.getByRole("link", {
      name: /OpenAI ships agent SDK with built-in tool routing/i,
    });
    expect(link.getAttribute("href")).toBe("https://example.com/agent-sdk");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText(/lost to "OpenAI ships agent SDK"/)).toBeTruthy();
    expect(screen.getByTestId("source-item-list").className).toContain("scrollbar-none");
    expect(screen.getByTestId("source-log-strip").className).toContain("scrollbar-none");
    expect(screen.getByTestId("source-log-strip").textContent).toContain("enrich.failed");
  });

  it("REQ-011: renders only the note and log strip for a failed empty source", async () => {
    vi.mocked(getRunSourceItems).mockResolvedValue(
      makeResponse({
        summary: {
          ranked: 0,
          shortlisted: 0,
          dedupedSurvivors: 0,
          dedupDropped: 0,
          enrichFailed: 0,
        },
        items: [],
        logs: [
          makeLog({
            id: 3,
            level: "error",
            event: "source.failed",
            message: "Twitter cookies not configured",
          }),
        ],
      }),
    );

    render(
      <SourceItemsPanel
        runId="run-1"
        source={{
          ...source,
          sourceType: "twitter",
          identifier: "@karpathy",
          displayName: "@karpathy",
          itemsFetched: 0,
          status: "failed",
        }}
        sourceKey="twitter:@karpathy"
      />,
      { wrapper: makeWrapper() },
    );

    await screen.findByText(/Source failed/i);
    expect(screen.queryByTestId("source-item-list")).toBeNull();
    expect(screen.getByTestId("source-log-strip").textContent).toContain(
      "source.failed",
    );
  });
});

describe("SourceTelemetryTable", () => {
  it("REQ-001, REQ-003: expands rows inline and lazily fetches source items only after expansion", async () => {
    vi.mocked(getRunSourceItems).mockResolvedValue(makeResponse({}));

    render(<SourceTelemetryTable runId="run-1" sources={[source]} />, {
      wrapper: makeWrapper(),
    });

    const row = screen.getByTestId("source-row-reddit");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(getRunSourceItems).not.toHaveBeenCalled();

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => {
      expect(getRunSourceItems).toHaveBeenCalledWith("run-1", "reddit:r/AI_Agents");
    });
    await screen.findByTestId("source-items-panel");

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("source-items-panel")).toBeNull();
  });
});
