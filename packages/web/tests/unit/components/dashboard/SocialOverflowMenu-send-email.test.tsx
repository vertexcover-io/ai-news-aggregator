/**
 * Tests for the "Send email" item in SocialOverflowMenu — on-demand digest
 * broadcast to confirmed subscribers (force-send).
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
    emailSentAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    linkedinPermalink: null,
    twitterPermalink: null,
    ...overrides,
  };
}

function renderMenu(
  run: RunSummary,
  onSendEmailConfirm = vi.fn(),
  emailPending = false,
): { onSendEmailConfirm: ReturnType<typeof vi.fn> } {
  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <SocialOverflowMenu
        run={run}
        runDate="Apr 14, 2026"
        onPostConfirm={vi.fn()}
        isPending={false}
        onSendEmailConfirm={onSendEmailConfirm}
        emailPending={emailPending}
      />
    </MemoryRouter>,
  );
  return { onSendEmailConfirm };
}

function openMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
}

describe("Send email item", () => {
  it("completed + reviewed + unsent → enabled; confirming fires onSendEmailConfirm", () => {
    const { onSendEmailConfirm } = renderMenu(makeRun());
    openMenu();

    const item = screen.getByRole("menuitem", { name: /send email/i });
    expect(item.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(item);

    // Confirm dialog → "Send now"
    fireEvent.click(screen.getByRole("button", { name: /send now/i }));
    expect(onSendEmailConfirm).toHaveBeenCalledOnce();
  });

  it("already sent → shows 'Email ✓ Sent' and no send button", () => {
    renderMenu(makeRun({ emailSentAt: "2026-04-14T07:30:00Z" }));
    openMenu();

    expect(screen.getByText(/email ✓ sent/i)).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: /send email/i }),
    ).toBeNull();
  });

  it("unreviewed run → 'Send email' disabled", () => {
    const { onSendEmailConfirm } = renderMenu(
      makeRun({ reviewed: false }),
    );
    openMenu();

    const item = screen.getByRole("menuitem", { name: /send email/i });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);
    expect(onSendEmailConfirm).not.toHaveBeenCalled();
  });

  it("dry-run → 'Send email' disabled", () => {
    renderMenu(makeRun({ isDryRun: true }));
    openMenu();

    expect(
      screen
        .getByRole("menuitem", { name: /send email/i })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });
});
