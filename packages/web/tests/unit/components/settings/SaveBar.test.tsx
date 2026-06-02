import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SaveBar } from "../../../../src/components/settings/SaveBar";

afterEach(() => {
  cleanup();
});

describe("SaveBar", () => {
  it("renders 'Run now', 'Save changes', and 'Check All' buttons by default", () => {
    render(
      <SaveBar
        saving={false}
        runNowDisabled={false}
        onRunNow={vi.fn()}
        onCheckAll={vi.fn()}
      />,
    );
    expect(screen.getByText("Run now")).toBeTruthy();
    expect(screen.getByText("Save changes")).toBeTruthy();
    expect(screen.getByText("Check All")).toBeTruthy();
  });

  it("'Check All' button is type='button'", () => {
    render(
      <SaveBar
        saving={false}
        runNowDisabled={false}
        onRunNow={vi.fn()}
        onCheckAll={vi.fn()}
      />,
    );
    const btn = screen.getByText("Check All").closest("button");
    expect(btn?.getAttribute("type")).toBe("button");
  });

  it("calls onCheckAll when 'Check All' is clicked", () => {
    const onCheckAll = vi.fn();
    render(
      <SaveBar
        saving={false}
        runNowDisabled={false}
        onRunNow={vi.fn()}
        onCheckAll={onCheckAll}
      />,
    );
    fireEvent.click(screen.getByText("Check All"));
    expect(onCheckAll).toHaveBeenCalledOnce();
  });

  it("disables 'Check All' when saving", () => {
    render(
      <SaveBar
        saving={true}
        runNowDisabled={false}
        onRunNow={vi.fn()}
        onCheckAll={vi.fn()}
      />,
    );
    const btn = screen.getByText("Check All").closest("button");
    expect(btn?.getAttribute("disabled")).not.toBeNull();
  });

  it("disables 'Check All' when checkAllDisabled is true", () => {
    render(
      <SaveBar
        saving={false}
        runNowDisabled={false}
        onRunNow={vi.fn()}
        onCheckAll={vi.fn()}
        checkAllDisabled={true}
      />,
    );
    const btn = screen.getByText("Check All").closest("button");
    expect(btn?.getAttribute("disabled")).not.toBeNull();
  });

  it("'Check All' is optional — does not render when onCheckAll is not passed", () => {
    render(
      <SaveBar
        saving={false}
        runNowDisabled={false}
        onRunNow={vi.fn()}
      />,
    );
    expect(screen.queryByText("Check All")).toBeNull();
  });
});
