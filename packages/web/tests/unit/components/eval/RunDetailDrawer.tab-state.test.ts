/**
 * Unit tests for the tab-state logic extracted from RunDetailDrawer.
 * Tests the `useDrawerTabState` hook's state transitions using plain functions
 * (simulating the state machine without React rendering).
 */
import { describe, expect, it } from "vitest";

// Mirror the state machine logic from useDrawerTabState for pure-function testing.
type DrawerTab = "prompt-cost" | "report";

interface TabState {
  runId: string | null;
  seenAvailable: boolean;
  tab: DrawerTab;
}

function computeNextTabState(
  current: TabState,
  runId: string | null,
  reportAvailable: boolean,
): { activeTab: DrawerTab; nextState: TabState } {
  const sameRun = current.runId === runId;
  if (!sameRun) {
    const activeTab: DrawerTab = reportAvailable ? "report" : "prompt-cost";
    return {
      activeTab,
      nextState: { runId, seenAvailable: reportAvailable, tab: activeTab },
    };
  }
  if (!current.seenAvailable && reportAvailable) {
    return {
      activeTab: "report",
      nextState: { runId, seenAvailable: true, tab: "report" },
    };
  }
  return { activeTab: current.tab, nextState: current };
}

const INITIAL: TabState = { runId: null, seenAvailable: false, tab: "prompt-cost" };

describe("drawer tab state transitions", () => {
  it("defaults to prompt-cost when no report available on new run", () => {
    const { activeTab } = computeNextTabState(INITIAL, "run-1", false);
    expect(activeTab).toBe("prompt-cost");
  });

  it("defaults to report when report is available on new run", () => {
    const { activeTab } = computeNextTabState(INITIAL, "run-1", true);
    expect(activeTab).toBe("report");
  });

  it("flips to report when data arrives (same run, first time available)", () => {
    // Simulate: opened run-1 with no report data yet → now data arrives
    const afterOpen = computeNextTabState(INITIAL, "run-1", false).nextState;
    const { activeTab } = computeNextTabState(afterOpen, "run-1", true);
    expect(activeTab).toBe("report");
  });

  it("does NOT flip again once seenAvailable=true even if still available", () => {
    const afterOpen = computeNextTabState(INITIAL, "run-1", false).nextState;
    const afterFlip = computeNextTabState(afterOpen, "run-1", true).nextState;
    // operator switches to prompt-cost manually
    const manualState: TabState = { ...afterFlip, tab: "prompt-cost" };
    const { activeTab } = computeNextTabState(manualState, "run-1", true);
    expect(activeTab).toBe("prompt-cost");
  });

  it("resets when a different run opens", () => {
    const withRun1: TabState = { runId: "run-1", seenAvailable: true, tab: "report" };
    const { activeTab, nextState } = computeNextTabState(withRun1, "run-2", false);
    expect(activeTab).toBe("prompt-cost");
    expect(nextState.runId).toBe("run-2");
    expect(nextState.seenAvailable).toBe(false);
  });
});
