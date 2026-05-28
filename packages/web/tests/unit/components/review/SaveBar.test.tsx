import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SaveBar } from "../../../../src/components/review/SaveBar";

afterEach(() => {
  cleanup();
});

describe("SaveBar", () => {
  it("renders the unsaved-changes summary (REQ-150)", () => {
    render(
      <SaveBar
        unsavedCount={3}
        saving={false}
        canSave
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByText("3 unsaved changes")).toBeTruthy();
  });

  it("disables Save when canSave is false (REQ-155)", () => {
    render(
      <SaveBar
        unsavedCount={0}
        saving={false}
        canSave={false}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const saveBtn = screen.getByRole("button", { name: /save & view archive/i });
    expect(saveBtn.hasAttribute("disabled")).toBe(true);
    expect(saveBtn.getAttribute("aria-disabled")).toBe("true");
  });

  it("calls onSave when Save is clicked (REQ-151)", () => {
    const onSave = vi.fn();
    render(
      <SaveBar
        unsavedCount={1}
        saving={false}
        canSave
        onSave={onSave}
        onDiscard={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /save & view archive/i }),
    );
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("renders the regen-required tooltip and title when disabledReason is set", () => {
    render(
      <SaveBar
        unsavedCount={1}
        saving={false}
        canSave={false}
        disabledReason="Regenerate the digest meta before saving — the ranked list has changed."
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const saveBtn = screen.getByRole("button", { name: /save & view archive/i });
    expect(saveBtn.hasAttribute("disabled")).toBe(true);
    expect(saveBtn.getAttribute("title")).toBe(
      "Regenerate the digest meta before saving — the ranked list has changed.",
    );
    const tooltip = screen.getByTestId("save-disabled-tooltip");
    expect(tooltip.textContent).toContain("Regenerate the digest meta");
    expect(tooltip.getAttribute("role")).toBe("tooltip");
  });

  it("does not render the tooltip when disabledReason is null", () => {
    render(
      <SaveBar
        unsavedCount={0}
        saving={false}
        canSave={false}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("save-disabled-tooltip")).toBeNull();
  });

  it("opens a confirm dialog with 'Discard all changes?' and only calls onDiscard after confirm (REQ-153)", () => {
    const onDiscard = vi.fn();
    render(
      <SaveBar
        unsavedCount={2}
        saving={false}
        canSave
        onSave={vi.fn()}
        onDiscard={onDiscard}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    // Dialog should be visible with confirm title
    expect(screen.getByText("Discard all changes?")).toBeTruthy();
    expect(onDiscard).not.toHaveBeenCalled();
    // Click the second "Discard" (inside dialog)
    const confirmButtons = screen.getAllByRole("button", { name: "Discard" });
    const confirm = confirmButtons[confirmButtons.length - 1];
    fireEvent.click(confirm);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
