import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SourcingReportRow } from "@newsletter/shared/types/eval-ranking";
import { SourcingReportPanel } from "../../src/components/eval/SourcingReportPanel";

afterEach(() => {
  cleanup();
});

describe("SourcingReportPanel", () => {
  it("returns null when rows empty", () => {
    const { container } = render(<SourcingReportPanel rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per source with totals", () => {
    const rows: SourcingReportRow[] = [
      { sourceType: "hn", mustIncludeCount: 3, niceCount: 1, dropCount: 0 },
      { sourceType: "reddit", mustIncludeCount: 1, niceCount: 2, dropCount: 4 },
    ];
    render(<SourcingReportPanel rows={rows} />);
    expect(screen.getByTestId("sourcing-report")).toBeTruthy();
    const hnRow = screen.getByTestId("sourcing-row-hn");
    expect(hnRow.textContent).toContain("hn");
    expect(hnRow.textContent).toContain("3");
    const redditRow = screen.getByTestId("sourcing-row-reddit");
    expect(redditRow.textContent).toContain("7");
  });
});
