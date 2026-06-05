import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RunSummary } from "@newsletter/shared";
import { RunsTable } from "../../../../src/components/dashboard/RunsTable";

// Mock the social post hook so we don't need a QueryClient
vi.mock("../../../../src/hooks/useTriggerSocialPost", () => ({
  useTriggerSocialPost: vi.fn(),
}));

import { useTriggerSocialPost } from "../../../../src/hooks/useTriggerSocialPost";
const mockUseTriggerSocialPost = useTriggerSocialPost as ReturnType<typeof vi.fn>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeMutation(overrides: Partial<ReturnType<typeof useTriggerSocialPost>> = {}): ReturnType<typeof useTriggerSocialPost> {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    isIdle: true,
    error: null,
    data: undefined,
    variables: undefined,
    status: "idle",
    reset: vi.fn(),
    context: undefined,
    failureCount: 0,
    failureReason: null,
    isPaused: false,
    submittedAt: 0,
    ...overrides,
  } as unknown as ReturnType<typeof useTriggerSocialPost>;
}

function makeRun(overrides: Partial<RunSummary>): RunSummary {
  return {
    runId: "r-1",
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

function renderTable(run: RunSummary): void {
  render(
    <MemoryRouter>
      <RunsTable
        runs={[run]}
        onRetry={vi.fn()}
        retrying={false}
        onCancel={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // Default: return an idle mutation
  mockUseTriggerSocialPost.mockReturnValue(makeMutation());
});

// REQ-008: Row renders a ⋮ trigger; opening shows both channel items
describe("REQ-008: overflow menu renders with both channel items", () => {
  it("renders a ⋮ (More actions) button per row", () => {
    renderTable(makeRun({ runId: "run-eligible" }));
    const menuBtn = screen.getByRole("button", { name: /more actions/i });
    expect(menuBtn).toBeTruthy();
  });

  it("opening ⋮ shows both LinkedIn and X items", () => {
    renderTable(makeRun({ runId: "run-eligible" }));
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("menuitem", { name: /linkedin/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /\bx\b/i })).toBeTruthy();
  });
});

// REQ-009: Eligible+unposted → both items enabled triggers
describe("REQ-009: eligible+unposted run shows enabled triggers", () => {
  it("both LinkedIn and X items are enabled (not aria-disabled)", () => {
    renderTable(
      makeRun({
        runId: "run-eligible",
        status: "completed",
        reviewed: true,
        isDryRun: false,
        linkedinPostedAt: null,
        twitterPostedAt: null,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    const li = screen.getByRole("menuitem", { name: /post to linkedin/i });
    const xi = screen.getByRole("menuitem", { name: /post to x/i });
    expect(li.getAttribute("aria-disabled")).not.toBe("true");
    expect(xi.getAttribute("aria-disabled")).not.toBe("true");
  });
});

// REQ-012: Activating item → confirm dialog; Cancel fires no POST; Confirm fires exactly one
describe("REQ-012: confirm dialog gates the POST", () => {
  it("clicking enabled LinkedIn item opens confirm dialog", async () => {
    renderTable(makeRun({ runId: "run-eligible" }));
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /post to linkedin/i }));
    await waitFor(() => {
      expect(screen.getByText(/post the .* digest to linkedin/i)).toBeTruthy();
    });
  });

  it("clicking Cancel in dialog fires no mutation", async () => {
    const mutate = vi.fn();
    mockUseTriggerSocialPost.mockReturnValue(makeMutation({ mutate }));
    renderTable(makeRun({ runId: "run-eligible" }));
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /post to linkedin/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("clicking 'Post now' in dialog calls mutate with 'linkedin' as first arg", async () => {
    const mutate = vi.fn();
    mockUseTriggerSocialPost.mockReturnValue(makeMutation({ mutate }));
    renderTable(makeRun({ runId: "run-eligible" }));
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /post to linkedin/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /post now/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /post now/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toBe("linkedin");
  });

  it("clicking 'Post now' for X calls mutate with 'twitter' as first arg", async () => {
    const mutate = vi.fn();
    mockUseTriggerSocialPost.mockReturnValue(makeMutation({ mutate }));
    renderTable(makeRun({ runId: "run-eligible" }));
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /post to x/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /post now/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /post now/i }));
    expect(mutate.mock.calls[0][0]).toBe("twitter");
  });
});

// REQ-010 + EDGE-001 + EDGE-007: Posted indicator with permalink link
describe("REQ-010 + EDGE-001 + EDGE-007: posted state", () => {
  it("LinkedIn posted + permalink set → LinkedIn item is an anchor with href=permalink; X item is enabled trigger", () => {
    renderTable(
      makeRun({
        runId: "run-posted-li",
        linkedinPostedAt: "2026-04-14T02:00:00Z",
        linkedinPermalink: "https://linkedin.com/share/abc",
        twitterPostedAt: null,
        twitterPermalink: null,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    // LinkedIn item should be a link (role=menuitem + anchor)
    const liLink = screen.getByRole("menuitem", { name: /linkedin.*view post/i });
    expect(liLink.tagName.toLowerCase()).toBe("a");
    expect(liLink.getAttribute("href")).toBe("https://linkedin.com/share/abc");
    // X item should be enabled trigger
    const xi = screen.getByRole("menuitem", { name: /post to x/i });
    expect(xi.getAttribute("aria-disabled")).not.toBe("true");
  });
});

// EDGE-009: linkedinPostedAt set but permalink null → non-link "✓ Posted"
describe("EDGE-009: null permalink renders non-link posted indicator", () => {
  it("renders '✓ Posted' text item (not a link) when postedAt set but permalink null", () => {
    renderTable(
      makeRun({
        runId: "run-posted-nolink",
        linkedinPostedAt: "2026-04-14T02:00:00Z",
        linkedinPermalink: null,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    // Should not be a link
    expect(screen.queryByRole("link", { name: /linkedin/i })).toBeNull();
    // Should show a posted indicator text
    expect(screen.getByText(/linkedin.*posted/i)).toBeTruthy();
  });
});

// REQ-011: Ineligible states → items disabled
describe("REQ-011: ineligible states disable menu items", () => {
  it.each<{
    label: string;
    overrides: Partial<RunSummary>;
    checkX: boolean;
  }>([
    {
      label: "unreviewed run",
      overrides: { runId: "run-unreviewed", status: "completed", reviewed: false, isDryRun: false },
      checkX: true,
    },
    {
      label: "dry-run",
      overrides: { runId: "run-dry", status: "completed", reviewed: true, isDryRun: true },
      checkX: false,
    },
    {
      label: "running status",
      overrides: { runId: "run-running", status: "running", reviewed: false },
      checkX: false,
    },
    {
      label: "failed status",
      overrides: { runId: "run-fail", status: "failed", reviewed: false },
      checkX: false,
    },
  ])("$label → menu items aria-disabled", ({ overrides, checkX }) => {
    renderTable(makeRun(overrides));
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    const li = screen.getByRole("menuitem", { name: /linkedin/i });
    expect(li.getAttribute("aria-disabled")).toBe("true");
    if (checkX) {
      const xi = screen.getByRole("menuitem", { name: /\bx\b/i });
      expect(xi.getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("disabled items do not call mutate when clicked", () => {
    const mutate = vi.fn();
    mockUseTriggerSocialPost.mockReturnValue(makeMutation({ mutate }));
    renderTable(
      makeRun({
        runId: "run-unreviewed",
        status: "completed",
        reviewed: false,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /linkedin/i }));
    expect(mutate).not.toHaveBeenCalled();
  });
});

// REQ-014 + EDGE-003: in-flight → triggering item disabled while mutation pending
describe("REQ-014 + EDGE-003: in-flight disables the triggering item", () => {
  it("while isPending, the linkedin menuitem is aria-disabled", () => {
    mockUseTriggerSocialPost.mockReturnValue(
      makeMutation({ isPending: true }),
    );
    renderTable(makeRun({ runId: "run-eligible" }));
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    const li = screen.getByRole("menuitem", { name: /post to linkedin/i });
    expect(li.getAttribute("aria-disabled")).toBe("true");
  });
});
