import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DebugTimeline } from "../../../../src/components/observability/DebugTimeline";
import { makeLog } from "./fixtures";

afterEach(() => {
  cleanup();
});

const logs = [
  makeLog({ id: 1, level: "info", event: "run.started", message: "started" }),
  makeLog({ id: 2, level: "warn", event: "enrichment.summary", message: "warned" }),
  makeLog({
    id: 3,
    level: "error",
    event: "source.failed",
    message: "boom",
    context: { stack: "Error: boom\n    at thing (file.ts:1)" },
  }),
];

describe("DebugTimeline (REQ-035, REQ-036, REQ-037)", () => {
  it("REQ-035: error rows render in error style and expose an expandable stack", () => {
    render(<DebugTimeline logs={logs} />);
    const rows = screen.getAllByTestId("log-row");
    const errorRow = rows.find((r) => r.getAttribute("data-level") === "error");
    expect(errorRow).toBeTruthy();
    expect(screen.queryByTestId("log-stack")).toBeNull();
    fireEvent.click(screen.getByTestId("log-stack-toggle"));
    expect(screen.getByTestId("log-stack").textContent).toContain("at thing");
  });

  it("REQ-036: selecting the Error filter narrows rows to errors only", () => {
    render(<DebugTimeline logs={logs} />);
    expect(screen.getAllByTestId("log-row").length).toBe(3);
    fireEvent.click(screen.getByTestId("level-filter-error"));
    const filtered = screen.getAllByTestId("log-row");
    expect(filtered.length).toBe(1);
    expect(filtered[0].getAttribute("data-level")).toBe("error");
  });

  it("REQ-036: All restores the full list", () => {
    render(<DebugTimeline logs={logs} />);
    fireEvent.click(screen.getByTestId("level-filter-warn"));
    expect(screen.getAllByTestId("log-row").length).toBe(1);
    fireEvent.click(screen.getByTestId("level-filter-all"));
    expect(screen.getAllByTestId("log-row").length).toBe(3);
  });

  it("REQ-037: empty logs render the empty state and no rows", () => {
    render(<DebugTimeline logs={[]} />);
    expect(screen.getByTestId("timeline-empty")).toBeTruthy();
    expect(screen.queryByTestId("log-row")).toBeNull();
  });

  it("renders a filter-empty state when a level filter matches no rows", () => {
    const noErrors = [
      makeLog({ id: 1, level: "info", event: "run.started", message: "started" }),
      makeLog({ id: 2, level: "warn", event: "enrichment.summary", message: "warned" }),
    ];
    render(<DebugTimeline logs={noErrors} />);
    fireEvent.click(screen.getByTestId("level-filter-error"));
    expect(screen.queryByTestId("log-row")).toBeNull();
    expect(screen.getByTestId("timeline-filter-empty")).toBeTruthy();
  });
});
