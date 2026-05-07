import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DateRangeChip } from "../../../../src/components/archive-listing/DateRangeChip";

afterEach(() => {
  cleanup();
});

describe("DateRangeChip", () => {
  it("shows ALL TIME label when no value", () => {
    render(<DateRangeChip value={undefined} onChange={() => undefined} />);
    expect(screen.getByText(/ALL TIME/)).toBeTruthy();
  });

  it("shows the formatted range label when value provided", () => {
    render(
      <DateRangeChip
        value={{ from: new Date(2026, 3, 8), to: new Date(2026, 4, 6) }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText(/APR 8 – MAY 6, 2026/)).toBeTruthy();
  });

  it("does not render popover when closed", () => {
    render(<DateRangeChip value={undefined} onChange={() => undefined} />);
    expect(screen.queryAllByRole("grid")).toHaveLength(0);
  });

  it("opens popover with 2 month grids on chip click", () => {
    render(<DateRangeChip value={undefined} onChange={() => undefined} />);
    const button = screen.getByRole("button", { name: /DATE/ });
    fireEvent.click(button);
    expect(screen.getAllByRole("grid").length).toBe(2);
  });

  it("clicking chip again closes popover", () => {
    render(<DateRangeChip value={undefined} onChange={() => undefined} />);
    const button = screen.getByRole("button", { name: /DATE/ });
    fireEvent.click(button);
    expect(screen.getAllByRole("grid").length).toBe(2);
    fireEvent.click(button);
    expect(screen.queryAllByRole("grid")).toHaveLength(0);
  });

  it("calls onChange when popover Apply is clicked with a range", () => {
    const onChange = vi.fn();
    render(
      <DateRangeChip
        value={{ from: new Date(2026, 3, 8), to: new Date(2026, 4, 6) }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /DATE/ }));
    fireEvent.click(screen.getByRole("button", { name: /Apply/i }));
    expect(onChange).toHaveBeenCalled();
  });

  it("chip button has min-h 44px touch target", () => {
    render(<DateRangeChip value={undefined} onChange={() => undefined} />);
    const button = screen.getByRole("button", { name: /DATE/ });
    expect(button.className).toMatch(/min-h-\[44px\]/);
  });
});
