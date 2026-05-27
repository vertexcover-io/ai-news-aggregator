import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StageTimingRail } from "../../../../src/components/observability/StageTimingRail";
import { CostStrip } from "../../../../src/components/observability/CostStrip";
import { SourceTelemetryTable } from "../../../../src/components/observability/SourceTelemetryTable";
import { EnrichmentStrip } from "../../../../src/components/observability/EnrichmentStrip";
import { LiveStatusPill } from "../../../../src/components/observability/LiveStatusPill";
import { costFixture, enrichmentFixture, fullFixture } from "./fixtures";

afterEach(() => {
  cleanup();
});

describe("StageTimingRail", () => {
  it("renders done/running/pending glyphs from stage timestamps", () => {
    render(<StageTimingRail stages={fullFixture.stages} />);
    expect(screen.getByTestId("stage-glyph-done")).toBeTruthy();
    expect(screen.getByTestId("stage-glyph-running")).toBeTruthy();
    expect(screen.getByTestId("stage-glyph-pending")).toBeTruthy();
    expect(screen.getByTestId("stage-row-collecting").textContent).toContain("38.2s");
  });
});

describe("CostStrip", () => {
  it("renders running total + per-stage cost and tokens", () => {
    render(<CostStrip cost={costFixture} live />);
    const strip = screen.getByTestId("cost-strip");
    expect(strip.textContent).toContain("Cost · so far");
    expect(strip.textContent).toContain("$0.021");
    expect(strip.textContent).toContain("$0.006");
  });

  it("renders gracefully with null cost (live)", () => {
    render(<CostStrip cost={null} live />);
    const strip = screen.getByTestId("cost-strip");
    expect(strip.textContent).toContain("?");
  });
});

describe("SourceTelemetryTable (EDGE-009)", () => {
  it("renders a row per source with status badges and a failed error note", () => {
    render(<SourceTelemetryTable runId="run-1" sources={fullFixture.sources} />);
    expect(screen.getByTestId("source-row-hacker_news")).toBeTruthy();
    expect(screen.getByTestId("source-badge-failed")).toBeTruthy();
    expect(screen.getByTestId("source-error-twitter").textContent).toContain(
      "auth failed",
    );
  });

  it("EDGE-009: a completed 0-item source shows 0 and no error note", () => {
    render(
      <SourceTelemetryTable
        runId="run-1"
        sources={[
          {
            sourceType: "rss",
            identifier: "empty.com",
            displayName: "empty.com",
            itemsFetched: 0,
            status: "completed",
            errors: [],
            retries: 0,
            durationMs: 1200,
          },
        ]}
      />,
    );
    expect(screen.getByTestId("source-row-rss").textContent).toContain("0");
    expect(screen.queryByTestId("source-error-rss")).toBeNull();
  });

  it("renders an empty state when there are no sources", () => {
    render(<SourceTelemetryTable runId="run-1" sources={[]} />);
    expect(screen.getByTestId("sources-empty")).toBeTruthy();
  });
});

describe("EnrichmentStrip (EDGE-010)", () => {
  it("renders the telemetry counts and skip chips", () => {
    render(<EnrichmentStrip enrichment={enrichmentFixture} />);
    const strip = screen.getByTestId("enrichment-strip");
    expect(strip.textContent).toContain("486");
    expect(strip.textContent).toContain("351");
    expect(screen.getByTestId("skip-chip-same-platform")).toBeTruthy();
  });

  it("EDGE-010: null enrichment renders all zeros, no crash", () => {
    render(<EnrichmentStrip enrichment={null} />);
    const strip = screen.getByTestId("enrichment-strip");
    expect(strip.textContent).toContain("0");
  });
});

describe("LiveStatusPill (REQ-034)", () => {
  it("renders status · stage and a live dot when live", () => {
    render(<LiveStatusPill status="running" stage="ranking" live />);
    const pill = screen.getByTestId("live-status-pill");
    expect(pill.getAttribute("data-live")).toBe("true");
    expect(pill.textContent).toContain("RUNNING · RANKING");
  });

  it("renders a static pill on terminal status", () => {
    render(<LiveStatusPill status="completed" stage="completed" live={false} />);
    const pill = screen.getByTestId("live-status-pill");
    expect(pill.getAttribute("data-live")).toBe("false");
    expect(pill.textContent).toContain("COMPLETED");
  });
});
