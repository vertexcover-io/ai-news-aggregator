/**
 * REQ-009 — itemCount UI consistency guard tests
 *
 * Phase 4 verification: the calendar run list row renders the API-provided
 * itemCount (deduped pool size), and the CalendarReportComparison column
 * headers count the ranking lengths (independent of pool size).
 */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

import { CalendarReportComparison } from "../../../../src/components/eval/CalendarReportComparison";
import type { CalendarReportDoneEntry } from "../../../../src/components/eval/CalendarReportComparison";

afterEach(() => {
  cleanup();
});

function makeItem(
  rawItemId: number,
  rank: number,
  title: string,
): {
  rawItemId: number;
  rank: number;
  title: string;
  url: string;
  sourceType: string;
  score: number;
  rationale: string;
  summary: string;
  bullets: string[];
  bottomLine: string;
} {
  return {
    rawItemId,
    rank,
    title,
    url: `https://example.com/${String(rawItemId)}`,
    sourceType: "hn",
    score: 0.9,
    rationale: "",
    summary: "",
    bullets: [],
    bottomLine: "",
  };
}

function makeReport(
  previousCount: number,
  draftCount: number,
  poolSize?: number,
): CalendarReportDoneEntry {
  const previousRanking = Array.from({ length: previousCount }, (_, i) =>
    makeItem(i + 1, i + 1, `Previous story ${String(i + 1)}`),
  );
  const draftRanking = Array.from({ length: draftCount }, (_, i) =>
    makeItem(100 + i + 1, i + 1, `Draft story ${String(i + 1)}`),
  );
  return {
    runId: "test-run-id",
    status: "done",
    previousRanking,
    draftRanking,
    promptDiff: {
      savedPromptHash: "aabbccdd",
      draftPromptHash: "11223344",
      savedPromptSnapshot: "saved prompt text",
      draftPromptSnapshot: "draft prompt text",
    },
    cost: {
      promptHash: "11223344",
      tokensIn: 100,
      tokensOut: 50,
      usd: 0.0422,
      cacheHit: false,
    },
    ...(poolSize === undefined ? {} : { poolSize }),
  };
}

function renderComparison(report: CalendarReportDoneEntry): void {
  function Wrapper(): ReactElement {
    return <CalendarReportComparison report={report} density="panel" />;
  }
  render(<Wrapper />);
}

describe("REQ-009 — CalendarReportComparison column counts reflect ranking lengths, not pool size", () => {
  it("previous column header shows the length of previousRanking (not pool size)", () => {
    // Pool size is conceptually 150, but previousRanking has 3 items.
    // The column must show "3 items" (the ranking count), not 150.
    const report = makeReport(3, 5);
    renderComparison(report);

    const previousSection = screen.getByTestId("calendar-report-previous-ranking");
    // The column header p tag shows the count
    expect(previousSection.textContent).toContain("3 items");
  });

  it("draft column header shows the length of draftRanking (not pool size)", () => {
    const report = makeReport(3, 7);
    renderComparison(report);

    const draftSection = screen.getByTestId("calendar-report-draft-ranking");
    expect(draftSection.textContent).toContain("7 items");
  });

  it("column counts are independent — previous and draft can differ", () => {
    // Previous has 10 items, draft has 8 (re-ranking can change the count)
    const report = makeReport(10, 8);
    renderComparison(report);

    const previousSection = screen.getByTestId("calendar-report-previous-ranking");
    const draftSection = screen.getByTestId("calendar-report-draft-ranking");

    expect(previousSection.textContent).toContain("10 items");
    expect(draftSection.textContent).toContain("8 items");
    // Verify they are independent (neither shows the other's count in its own section)
    expect(previousSection.textContent).not.toContain("8 items");
    expect(draftSection.textContent).not.toContain("10 items");
  });

  it("singular label: 1 item (not '1 items')", () => {
    const report = makeReport(1, 1);
    renderComparison(report);

    const previousSection = screen.getByTestId("calendar-report-previous-ranking");
    expect(previousSection.textContent).toContain("1 item");
    expect(previousSection.textContent).not.toContain("1 items");
  });

  it("summary stats row shows previous and draft ranking counts separately", () => {
    // The two ranking columns show Previous count and Draft count
    const report = makeReport(5, 3);
    renderComparison(report);

    const layout = screen.getByTestId("calendar-report-layout");
    expect(layout.textContent).toContain("5 items");
    expect(layout.textContent).toContain("3 items");
  });
});

describe("REQ-007/REQ-008 — Mode B funnel (sent → ranked → cost)", () => {
  it("renders a 3-cell funnel when poolSize is known", () => {
    const report = makeReport(12, 10, 47);
    renderComparison(report);

    const funnel = screen.getByTestId("calendar-report-funnel");
    expect(funnel.textContent).toContain("Sent for ranking");
    expect(funnel.textContent).toContain("Ranked");
    expect(funnel.textContent).toContain("Cost");
  });

  it("REQ-008: sent cell shows poolSize, ranked cell shows draftRanking length", () => {
    const report = makeReport(12, 10, 47);
    renderComparison(report);

    const sent = screen.getByTestId("calendar-report-funnel-sent");
    expect(sent.textContent).toContain("47");
    const ranked = screen.getByTestId("calendar-report-funnel-ranked");
    expect(ranked.textContent).toContain("10");
    expect(ranked.textContent).not.toContain("47");
  });

  it("cost cell shows the run cost in USD", () => {
    const report = makeReport(12, 10, 47);
    renderComparison(report);

    const cost = screen.getByTestId("calendar-report-funnel-cost");
    expect(cost.textContent).toContain("$0.0422");
  });

  it("shows the considered-but-not-surfaced note as (sent − ranked) when sent > ranked", () => {
    const report = makeReport(12, 10, 47);
    renderComparison(report);

    const note = screen.getByTestId("calendar-report-funnel-note");
    // 47 sent - 10 ranked = 37 considered but not surfaced
    expect(note.textContent).toContain("37");
    expect(note.textContent).toContain("considered but not surfaced");
  });

  it("EDGE-002: suppresses the note when sent <= ranked", () => {
    // pool size equals the ranked count → nothing dropped
    const report = makeReport(10, 10, 10);
    renderComparison(report);

    expect(screen.queryByTestId("calendar-report-funnel-note")).toBeNull();
  });

  it("EDGE-001: omits the sent cell and shows no NaN/undefined when poolSize is unknown", () => {
    const report = makeReport(12, 10);
    renderComparison(report);

    const funnel = screen.getByTestId("calendar-report-funnel");
    expect(screen.queryByTestId("calendar-report-funnel-sent")).toBeNull();
    expect(funnel.textContent).toContain("Ranked");
    expect(funnel.textContent).toContain("Cost");
    expect(funnel.textContent).not.toContain("NaN");
    expect(funnel.textContent).not.toContain("undefined");
    // No note without a known sent count.
    expect(screen.queryByTestId("calendar-report-funnel-note")).toBeNull();
  });
});
