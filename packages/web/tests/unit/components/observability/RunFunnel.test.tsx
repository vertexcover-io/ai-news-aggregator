import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RunFunnel } from "../../../../src/components/observability/RunFunnel";

afterEach(() => {
  cleanup();
});

describe("RunFunnel (REQ-034, EDGE-005)", () => {
  it("REQ-034: renders the ranked stage as pending hatched bar with '— / topN' when ranked is null", () => {
    render(
      <RunFunnel
        funnel={{ collected: 1284, deduped: 542, shortlisted: 60, ranked: null }}
        topN={12}
      />,
    );
    const rankedRow = screen.getByTestId("funnel-row-rank");
    expect(rankedRow.getAttribute("data-pending")).toBe("true");
    expect(rankedRow.textContent).toContain("— / 12");
  });

  it("renders concrete counts for reached stages", () => {
    render(
      <RunFunnel
        funnel={{ collected: 1284, deduped: 542, shortlisted: 60, ranked: 12 }}
        topN={12}
      />,
    );
    expect(screen.getByTestId("funnel-row-collected").textContent).toContain(
      "1,284",
    );
    expect(screen.getByTestId("funnel-row-collected").getAttribute("data-pending")).toBe(
      "false",
    );
  });

  it("EDGE-005: legacy null funnel renders '—' across all rows, no crash", () => {
    render(
      <RunFunnel
        funnel={{ collected: null, deduped: null, shortlisted: null, ranked: null }}
        topN={null}
      />,
    );
    expect(screen.getByTestId("funnel-row-collected").textContent).toContain("—");
    expect(screen.getByTestId("funnel-row-deduped").getAttribute("data-pending")).toBe(
      "true",
    );
    expect(screen.getByTestId("funnel-row-rank").textContent).toContain("— / ?");
  });

  it("shows the duplicates-removed drop annotation between collected and deduped", () => {
    render(
      <RunFunnel
        funnel={{ collected: 1000, deduped: 600, shortlisted: 60, ranked: 12 }}
        topN={12}
      />,
    );
    expect(screen.getByText(/−400/)).toBeTruthy();
  });
});
