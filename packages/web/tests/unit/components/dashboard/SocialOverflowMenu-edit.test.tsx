/**
 * Tests for "Edit newsletter" item in SocialOverflowMenu.
 * Traces: REQ-001, REQ-002, EDGE-003, EDGE-004
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RunSummary } from "@newsletter/shared";
import { SocialOverflowMenu } from "../../../../src/components/dashboard/SocialOverflowMenu";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: "run-test-1",
    startedAt: "2026-04-14T00:00:00Z",
    completedAt: "2026-04-14T00:01:00Z",
    status: "completed",
    itemCount: 10,
    reviewed: true,
    isDryRun: false,
    costBreakdown: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    linkedinPermalink: null,
    twitterPermalink: null,
    ...overrides,
  };
}

function renderMenu(run: RunSummary): void {
  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <SocialOverflowMenu
        run={run}
        runDate="Apr 14, 2026"
        onPostConfirm={vi.fn()}
        isPending={false}
        onSendEmailConfirm={vi.fn()}
        emailPending={false}
      />
    </MemoryRouter>,
  );
}

// REQ-001: completed + reviewed → "Edit newsletter" enabled, navigates to /admin/review/:runId
describe("test_REQ_001_edit_item_enabled_for_reviewed_run", () => {
  it("enabled for completed+reviewed run and has correct review link", () => {
    const run = makeRun({ runId: "run-r1", status: "completed", reviewed: true });
    renderMenu(run);

    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));

    const editItem = screen.getByRole("menuitem", { name: /edit newsletter/i });
    expect(editItem).toBeTruthy();
    expect(editItem.getAttribute("aria-disabled")).not.toBe("true");
    // Link element should point to the review page
    expect(editItem.getAttribute("href")).toBe("/admin/review/run-r1");
  });
});

// REQ-002: completed + NOT reviewed → "Edit newsletter" disabled, no navigation
describe("test_REQ_002_edit_item_disabled_when_not_reviewed", () => {
  it("disabled for completed+unreviewed run; not a link", () => {
    const run = makeRun({ runId: "run-r2", status: "completed", reviewed: false });
    renderMenu(run);

    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));

    const editItem = screen.getByRole("menuitem", { name: /edit newsletter/i });
    expect(editItem.getAttribute("aria-disabled")).toBe("true");
    // Disabled item is a button, not a link — no href
    expect(editItem.getAttribute("href")).toBeNull();
  });
});

// EDGE-003: completed + reviewed + isDryRun → enabled (dry-run included by design)
describe("test_EDGE_003_dryrun_reviewed_edit_enabled", () => {
  it("enabled for dry-run reviewed run", () => {
    const run = makeRun({
      runId: "run-dry",
      status: "completed",
      reviewed: true,
      isDryRun: true,
    });
    renderMenu(run);

    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));

    const editItem = screen.getByRole("menuitem", { name: /edit newsletter/i });
    expect(editItem.getAttribute("aria-disabled")).not.toBe("true");
    expect(editItem.getAttribute("href")).toBe("/admin/review/run-dry");
  });
});

// EDGE-004: all non-eligible states → disabled
describe("test_EDGE_004_edit_disabled_across_ineligible_states", () => {
  const ineligibleCases: { label: string; overrides: Partial<RunSummary> }[] = [
    { label: "running", overrides: { status: "running", reviewed: false } },
    { label: "failed", overrides: { status: "failed", reviewed: false } },
    { label: "cancelling", overrides: { status: "cancelling", reviewed: false } },
    { label: "cancelled", overrides: { status: "cancelled", reviewed: false } },
    { label: "completed-unreviewed", overrides: { status: "completed", reviewed: false } },
  ];

  ineligibleCases.forEach(({ label, overrides }) => {
    it(`edit item disabled for ${label} run`, () => {
      const run = makeRun({ runId: `run-${label}`, ...overrides });
      renderMenu(run);

      fireEvent.click(screen.getByRole("button", { name: /more actions/i }));

      const editItem = screen.getByRole("menuitem", { name: /edit newsletter/i });
      expect(editItem.getAttribute("aria-disabled")).toBe("true");
    });
  });
});
