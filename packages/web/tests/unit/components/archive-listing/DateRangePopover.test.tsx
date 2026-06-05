import { describe, expect, it, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { DateRangePopover } from "../../../../src/components/archive-listing/DateRangePopover";
import type { DateRangeValue } from "../../../../src/lib/dateRange";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 4, 7, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("DateRangePopover", () => {
  it("renders 2 month grids", () => {
    render(
      <DateRangePopover
        value={undefined}
        onApply={() => undefined}
        onClear={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getAllByRole("grid").length).toBe(2);
  });

  it("renders preset chips", () => {
    render(
      <DateRangePopover
        value={undefined}
        onApply={() => undefined}
        onClear={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: /Last 7 days/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Last 30 days/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Last 90 days/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /This year/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /All time/i })).toBeTruthy();
  });

  it("clicking Last 30 days preset updates the selected header label", () => {
    render(
      <DateRangePopover
        value={undefined}
        onApply={() => undefined}
        onClear={() => undefined}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Last 30 days/i }));
    // After preset, the header should show a non-em-dash label.
    const header = screen.getByTestId("range-selected-label");
    expect(header.textContent).not.toBe("—");
    expect(header.textContent).toMatch(/2026/);
  });

  it("Apply with complete range calls onApply and onClose", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <DateRangePopover
        value={{ from: new Date(2026, 3, 8), to: new Date(2026, 4, 6) }}
        onApply={onApply}
        onClear={() => undefined}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Apply is disabled when range is incomplete", () => {
    render(
      <DateRangePopover
        value={{ from: new Date(2026, 3, 8), to: undefined }}
        onApply={() => undefined}
        onClear={() => undefined}
        onClose={() => undefined}
      />,
    );
    const apply = screen.getByRole<HTMLButtonElement>("button", { name: /Apply/i });
    expect(apply.disabled).toBe(true);
  });

  it("Clear calls onClear and onClose", () => {
    const onClear = vi.fn();
    const onClose = vi.fn();
    render(
      <DateRangePopover
        value={{ from: new Date(2026, 3, 8), to: new Date(2026, 4, 6) }}
        onApply={() => undefined}
        onClear={onClear}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Clear/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("All time preset clears the local range", () => {
    render(
      <DateRangePopover
        value={{ from: new Date(2026, 3, 8), to: new Date(2026, 4, 6) }}
        onApply={() => undefined}
        onClear={() => undefined}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /All time/i }));
    const header = screen.getByTestId("range-selected-label");
    expect(header.textContent).toBe("—");
    const apply = screen.getByRole<HTMLButtonElement>("button", { name: /Apply/i });
    expect(apply.disabled).toBe(true);
  });

  it("click outside closes the popover", () => {
    const onClose = vi.fn();
    render(
      <div>
        <DateRangePopover
          value={undefined}
          onApply={() => undefined}
          onClear={() => undefined}
          onClose={onClose}
        />
        <button data-testid="outside">outside</button>
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalled();
  });

  it("selecting a start then an end day in the grid passes the {from,to} range to onApply", () => {
    const onApply = vi.fn<(range: DateRangeValue) => void>();
    render(
      <DateRangePopover
        value={undefined}
        onApply={onApply}
        onClear={() => undefined}
        onClose={() => undefined}
      />,
    );

    // System time is 2026-05-07, so the first month grid is May 2026.
    const [mayGrid] = screen.getAllByRole("grid");

    // Day-cell buttons in react-day-picker render the day number as their text.
    const dayButton = (day: string): HTMLElement => {
      const cell = within(mayGrid)
        .getAllByRole("gridcell")
        .find((el) => el.textContent?.trim() === day);
      if (cell === undefined) {
        throw new Error(`could not find day cell "${day}" in the May grid`);
      }
      const button = cell.querySelector("button");
      // Some rdp setups render the gridcell itself as the button.
      return button ?? cell;
    };

    // Pick a start (the 10th) then an end (the 20th).
    fireEvent.click(dayButton("10"));
    fireEvent.click(dayButton("20"));

    // Apply becomes enabled once both ends are chosen.
    const apply = screen.getByRole<HTMLButtonElement>("button", { name: /Apply/i });
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);

    expect(onApply).toHaveBeenCalledTimes(1);
    const range = onApply.mock.calls[0][0];
    const { from, to } = range;
    if (!(from instanceof Date) || !(to instanceof Date)) {
      throw new Error("expected onApply to receive a complete {from,to} range");
    }
    expect(from.getDate()).toBe(10);
    expect(to.getDate()).toBe(20);
    expect(from.getMonth()).toBe(4); // May (0-indexed)
    expect(to.getMonth()).toBe(4);
  });
});
