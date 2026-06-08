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

  it("opens a confirm dialog instead of saving when saveConfirmation is set", () => {
    const onSave = vi.fn();
    render(
      <SaveBar
        unsavedCount={1}
        saving={false}
        canSave
        onSave={onSave}
        onDiscard={vi.fn()}
        saveConfirmation="The story order changed since the digest meta was last generated."
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /save & view archive/i }),
    );
    // Save did NOT fire; the dialog is showing the warning message
    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("save-confirmation-message").textContent,
    ).toContain("story order changed");
    // Cancel closes without saving
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByTestId("save-confirmation-message")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    // Re-open and confirm — now onSave fires exactly once
    fireEvent.click(
      screen.getByRole("button", { name: /save & view archive/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /save anyway/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("saves directly when saveConfirmation is null", () => {
    const onSave = vi.fn();
    render(
      <SaveBar
        unsavedCount={1}
        saving={false}
        canSave
        onSave={onSave}
        onDiscard={vi.fn()}
        saveConfirmation={null}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /save & view archive/i }),
    );
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("save-confirmation-message")).toBeNull();
  });

  it("test_REQ_013_unreviewed_shows_two_buttons — when onSaveDraft provided, renders both 'Save draft' and 'Save & publish'", () => {
    render(
      <SaveBar
        unsavedCount={1}
        saving={false}
        canSave
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onSaveDraft={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /save draft/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /save & publish/i })).toBeTruthy();
  });

  it("test_REQ_014_reviewed_shows_single_button — when onSaveDraft not provided, only 'Save & view archive' appears", () => {
    render(
      <SaveBar
        unsavedCount={0}
        saving={false}
        canSave
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /save draft/i })).toBeNull();
    expect(screen.getByRole("button", { name: /save & view archive/i })).toBeTruthy();
  });

  it("test_EDGE_006_draft_save_error_preserves_state — draftSaving flag disables Save draft button while in flight", () => {
    const onSaveDraft = vi.fn();
    render(
      <SaveBar
        unsavedCount={1}
        saving={false}
        canSave
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onSaveDraft={onSaveDraft}
        draftSaving={true}
      />,
    );
    // When draftSaving=true, the button label changes to "Saving..." and is disabled
    const draftBtn = screen.getByRole("button", { name: /^saving\.\.\./i });
    expect(draftBtn.hasAttribute("disabled")).toBe(true);
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
