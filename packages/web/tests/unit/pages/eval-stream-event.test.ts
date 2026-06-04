import { describe, expect, it, vi } from "vitest";
import { handleStreamEvent } from "../../../src/pages/EvalIndexPage";
import type React from "react";

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

function makeSetters() {
  return {
    setRows: vi.fn() as Setter<unknown[]>,
    setCalendarRows: vi.fn() as Setter<unknown[]>,
    setTotalUsd: vi.fn() as Setter<number | null>,
    setRunError: vi.fn() as Setter<string | null>,
    setSourcing: vi.fn() as Setter<unknown[]>,
  };
}

describe("handleStreamEvent", () => {
  it("dispatches scored progress to setRows when mode=scored", () => {
    const setters = makeSetters();
    handleStreamEvent(
      {
        event: "progress",
        data: { fixtureId: "f1", status: "done", score: { ndcgAt10: 0.8 } },
      },
      "scored",
      setters as Parameters<typeof handleStreamEvent>[2],
    );
    expect(setters.setRows).toHaveBeenCalledOnce();
    expect(setters.setCalendarRows).not.toHaveBeenCalled();
  });

  it("dispatches calendar progress to setCalendarRows when mode=ab", () => {
    const setters = makeSetters();
    handleStreamEvent(
      { event: "progress", data: { runId: "r1", status: "running" } },
      "ab",
      setters as Parameters<typeof handleStreamEvent>[2],
    );
    expect(setters.setCalendarRows).toHaveBeenCalledOnce();
    expect(setters.setRows).not.toHaveBeenCalled();
  });

  it("updates totalUsd on aggregate event", () => {
    const setters = makeSetters();
    handleStreamEvent(
      { event: "aggregate", data: { totalCost: { usd: 0.005 } } },
      "scored",
      setters as Parameters<typeof handleStreamEvent>[2],
    );
    expect(setters.setTotalUsd).toHaveBeenCalledWith(0.005);
  });

  it("updates totalUsd on done event", () => {
    const setters = makeSetters();
    handleStreamEvent(
      { event: "done", data: { totalCost: { usd: 0.01 } } },
      "scored",
      setters as Parameters<typeof handleStreamEvent>[2],
    );
    expect(setters.setTotalUsd).toHaveBeenCalledWith(0.01);
  });

  it("sets run error on error event", () => {
    const setters = makeSetters();
    handleStreamEvent(
      { event: "error", data: { message: "timeout" } },
      "scored",
      setters as Parameters<typeof handleStreamEvent>[2],
    );
    expect(setters.setRunError).toHaveBeenCalledWith("timeout");
  });

  it("uses fallback message for error event with no message field", () => {
    const setters = makeSetters();
    handleStreamEvent(
      { event: "error", data: {} },
      "scored",
      setters as Parameters<typeof handleStreamEvent>[2],
    );
    expect(setters.setRunError).toHaveBeenCalledWith("run failed");
  });

  it("sets calendar rows from aggregate calendarRuns", () => {
    const setters = makeSetters();
    const calendarRuns = [{ runId: "r1", status: "done" }];
    handleStreamEvent(
      { event: "aggregate", data: { calendarRuns } },
      "ab",
      setters as Parameters<typeof handleStreamEvent>[2],
    );
    expect(setters.setCalendarRows).toHaveBeenCalledWith(calendarRuns);
  });

  it("updates sourcing on aggregate event with sourcingReport", () => {
    const setters = makeSetters();
    const report = [{ sourceType: "hn", mustIncludeCount: 1, niceCount: 2, dropCount: 0 }];
    handleStreamEvent(
      { event: "aggregate", data: { sourcingReport: report } },
      "scored",
      setters as Parameters<typeof handleStreamEvent>[2],
    );
    expect(setters.setSourcing).toHaveBeenCalledWith(report);
  });

  it("ignores unknown events without throwing", () => {
    const setters = makeSetters();
    expect(() => {
      handleStreamEvent(
        { event: "unknown_event", data: {} },
        "scored",
        setters as Parameters<typeof handleStreamEvent>[2],
      );
    }).not.toThrow();
    expect(setters.setRows).not.toHaveBeenCalled();
    expect(setters.setRunError).not.toHaveBeenCalled();
  });
});
