/**
 * Phase 3 — Mode A Report tab funnel + hidden scrollbars.
 *
 * REQ-006: the Mode A ranking scroll region hides its scrollbar.
 * REQ-007: the funnel renders three cells (sent / ranked / cost).
 * EDGE-006: the funnel's sent = fixture pool size, ranked = actual-ranking length.
 * EDGE-001: when pool size is unknown the funnel omits the sent cell, no NaN.
 * EDGE-002: when sent == ranked the considered-but-not-surfaced note is suppressed.
 */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import type {
  ActualRankingItem,
  ExpectedRankingItem,
} from "@newsletter/shared/types/eval-ranking";

import { ReportTab } from "../../../../src/components/eval/ReportTab";

afterEach(() => {
  cleanup();
});

function actual(
  rawItemId: number,
  title: string,
  score: number,
): ActualRankingItem {
  return {
    rawItemId,
    url: `https://example.com/${String(rawItemId)}`,
    title,
    score,
    rationale: "",
    summary: "",
    bullets: [],
    bottomLine: "",
  };
}

function expected(
  rank: number,
  rawItemId: number,
  title: string,
  tier: ExpectedRankingItem["tier"],
): ExpectedRankingItem {
  return {
    rawItemId,
    url: `https://example.com/${String(rawItemId)}`,
    title,
    tier,
    rank,
  };
}

const scoreSheet = {
  ndcgAt10: 0.842,
  ndcgAt5: 0.791,
  precisionAt10: 0.7,
  mustIncludeRecall: 0.857,
  rankOneIsMustInclude: true,
};

function renderTab(
  actualRanking: readonly ActualRankingItem[],
  poolSize: number | undefined,
  costUsd: number,
): void {
  const expectedRanking: ExpectedRankingItem[] = [
    expected(1, 1, "Expected one", "must"),
    expected(2, 2, "Expected two", "nice"),
  ];
  function Wrapper(): ReactElement {
    return (
      <ReportTab
        actualRanking={actualRanking}
        expectedRanking={expectedRanking}
        scoreSheet={scoreSheet}
        poolSize={poolSize}
        costUsd={costUsd}
      />
    );
  }
  render(<Wrapper />);
}

describe("ReportTab — Mode A funnel", () => {
  it("REQ-007: renders a 3-cell funnel (sent / ranked / cost) when poolSize is known", () => {
    const ranking = [actual(1, "A", 0.9), actual(2, "B", 0.8)];
    renderTab(ranking, 32, 0.014);

    const funnel = screen.getByTestId("report-tab-funnel");
    expect(funnel.textContent).toContain("Sent for ranking");
    expect(funnel.textContent).toContain("Ranked");
    expect(funnel.textContent).toContain("Cost");
  });

  it("EDGE-006: sent cell = fixture pool size, ranked cell = actual-ranking length", () => {
    const ranking = [actual(1, "A", 0.9), actual(2, "B", 0.8), actual(3, "C", 0.7)];
    renderTab(ranking, 32, 0.014);

    expect(screen.getByTestId("report-tab-funnel-sent").textContent).toContain(
      "32",
    );
    const ranked = screen.getByTestId("report-tab-funnel-ranked");
    expect(ranked.textContent).toContain("3");
    expect(ranked.textContent).not.toContain("32");
  });

  it("cost cell shows the run cost in USD", () => {
    renderTab([actual(1, "A", 0.9)], 32, 0.014);
    expect(screen.getByTestId("report-tab-funnel-cost").textContent).toContain(
      "$0.0140",
    );
  });

  it("note shows (sent − ranked) considered but not surfaced", () => {
    const ranking = [actual(1, "A", 0.9), actual(2, "B", 0.8)];
    renderTab(ranking, 32, 0.014);

    const note = screen.getByTestId("report-tab-funnel-note");
    expect(note.textContent).toContain("30");
    expect(note.textContent).toContain("considered but not surfaced");
  });

  it("EDGE-002: suppresses the note when sent == ranked", () => {
    const ranking = [actual(1, "A", 0.9), actual(2, "B", 0.8)];
    renderTab(ranking, 2, 0.014);
    expect(screen.queryByTestId("report-tab-funnel-note")).toBeNull();
  });

  it("EDGE-001: omits the sent cell and shows no NaN/undefined when poolSize unknown", () => {
    const ranking = [actual(1, "A", 0.9), actual(2, "B", 0.8)];
    renderTab(ranking, undefined, 0.014);

    const funnel = screen.getByTestId("report-tab-funnel");
    expect(screen.queryByTestId("report-tab-funnel-sent")).toBeNull();
    expect(funnel.textContent).toContain("Ranked");
    expect(funnel.textContent).not.toContain("NaN");
    expect(funnel.textContent).not.toContain("undefined");
    expect(screen.queryByTestId("report-tab-funnel-note")).toBeNull();
  });

  it("REQ-006: the ranking scroll region hides its scrollbar on an overflow-auto container", () => {
    renderTab([actual(1, "A", 0.9)], 32, 0.014);
    const region = screen.getByTestId("report-tab-ranking-scroll");
    expect(region.className).toContain("scrollbar-none");
    expect(region.className).toContain("overflow-auto");
  });
});
