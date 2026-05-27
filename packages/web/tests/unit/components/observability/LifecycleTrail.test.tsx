import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RunSourceItem } from "@newsletter/shared/types";
import { LifecycleTrail } from "../../../../src/components/observability/LifecycleTrail";

afterEach(() => {
  cleanup();
});

function makeItem(overrides: Partial<RunSourceItem>): RunSourceItem {
  return {
    id: 1,
    title: "OpenAI ships agent SDK",
    url: "https://example.com/agent-sdk",
    author: "devshipper",
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

describe("LifecycleTrail", () => {
  it("REQ-005: renders the approved vocabulary for a ranked item", () => {
    render(<LifecycleTrail item={makeItem({})} live={false} />);

    expect(screen.getByText("Fetched")).toBeTruthy();
    expect(screen.getByText("Enriched")).toBeTruthy();
    expect(screen.getByText("Survived")).toBeTruthy();
    expect(screen.getByText("Shortlisted")).toBeTruthy();
    expect(screen.getByText("Ranked #1")).toBeTruthy();
  });

  it("REQ-007: stops the trail at Dedup-dropped", () => {
    render(
      <LifecycleTrail
        item={makeItem({
          lifecycle: {
            fetched: true,
            enrich: { status: "ok", reason: null },
            dedup: { status: "dropped", winnerTitle: "Winner", winnerId: 2, winnerPoints: 20 },
            shortlisted: false,
            rank: null,
          },
          furthestStage: "dedup-dropped",
          dropReason: "dedup-dropped · duplicate URL",
        })}
        live={false}
      />,
    );

    expect(screen.getByText("Dedup-dropped")).toBeTruthy();
    expect(screen.queryByText("Shortlisted")).toBeNull();
    expect(screen.queryByText("Not shortlisted")).toBeNull();
  });

  it("REQ-013: renders Pending for live shortlist and rank stages not yet reached", () => {
    render(
      <LifecycleTrail
        item={makeItem({
          lifecycle: {
            fetched: true,
            enrich: { status: "skipped", reason: "same-platform" },
            dedup: { status: "survived", winnerTitle: null, winnerId: null, winnerPoints: null },
            shortlisted: null,
            rank: null,
          },
          furthestStage: "deduped-survivor",
        })}
        live
      />,
    );

    expect(screen.getByText("Enrich-skipped")).toBeTruthy();
    expect(screen.getAllByText("Pending")).toHaveLength(2);
  });

  it("renders Not shortlisted for a live item when shortlist has completed and excluded it", () => {
    render(
      <LifecycleTrail
        item={makeItem({
          lifecycle: {
            fetched: true,
            enrich: { status: "ok", reason: null },
            dedup: { status: "survived", winnerTitle: null, winnerId: null, winnerPoints: null },
            shortlisted: false,
            rank: null,
          },
          furthestStage: "deduped-survivor",
        })}
        live
      />,
    );

    expect(screen.getByText("Not shortlisted")).toBeTruthy();
    expect(screen.getAllByText("Pending")).toHaveLength(1);
  });
});
