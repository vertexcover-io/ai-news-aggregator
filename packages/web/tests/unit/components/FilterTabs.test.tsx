import { describe, expect, it, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useSearchParams } from "react-router-dom";
import type { ReactElement } from "react";
import {
  FilterTabs,
  rangeForFilter,
  filterFromRange,
} from "../../../src/components/archive-listing/FilterTabs";

afterEach(() => {
  cleanup();
});

function ParamsProbe({ onChange }: { onChange: (s: string) => void }): ReactElement {
  const [params] = useSearchParams();
  onChange(params.toString());
  return <></>;
}

const NOW = new Date("2026-05-08T12:00:00Z");

function renderWithRouter(initial = "/"): { paramsLog: string[] } {
  const paramsLog: string[] = [];
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <FilterTabs now={NOW} />
              <ParamsProbe onChange={(s) => paramsLog.push(s)} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { paramsLog };
}

describe("FilterTabs", () => {
  it("renders all four tab labels", () => {
    renderWithRouter();
    expect(screen.getByRole("button", { name: /all time/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /this month/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /last 30 days/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "2026" })).toBeTruthy();
  });

  it("marks 'All time' active when no from/to params present", () => {
    renderWithRouter("/");
    expect(
      screen.getByRole("button", { name: /all time/i }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("marks 'This month' active when URL params match its range", () => {
    renderWithRouter("/?from=2026-05-01&to=2026-05-08");
    expect(
      screen.getByRole("button", { name: /this month/i }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("clicking 'Last 30 days' sets ?from=&to= query params", () => {
    const { paramsLog } = renderWithRouter("/");
    fireEvent.click(screen.getByRole("button", { name: /last 30 days/i }));
    const last = paramsLog.at(-1) ?? "";
    expect(last).toContain("from=2026-04-08");
    expect(last).toContain("to=2026-05-08");
  });

  it("clicking 'All time' clears from/to query params", () => {
    const { paramsLog } = renderWithRouter("/?from=2026-01-01&to=2026-05-08");
    fireEvent.click(screen.getByRole("button", { name: /all time/i }));
    expect(paramsLog.at(-1)).toBe("");
  });
});

describe("rangeForFilter", () => {
  it("returns empty for 'all'", () => {
    expect(rangeForFilter("all", NOW)).toEqual({});
  });

  it("returns first-of-month → today for 'month'", () => {
    expect(rangeForFilter("month", NOW)).toEqual({
      from: "2026-05-01",
      to: "2026-05-08",
    });
  });

  it("returns 30 days back → today for '30d'", () => {
    expect(rangeForFilter("30d", NOW)).toEqual({
      from: "2026-04-08",
      to: "2026-05-08",
    });
  });

  it("returns Jan 1 → today for 'year'", () => {
    expect(rangeForFilter("year", NOW)).toEqual({
      from: "2026-01-01",
      to: "2026-05-08",
    });
  });
});

describe("filterFromRange", () => {
  it("returns 'all' for empty params", () => {
    expect(filterFromRange({}, NOW)).toBe("all");
  });

  it("returns 'month' for matching this-month range", () => {
    expect(
      filterFromRange({ from: "2026-05-01", to: "2026-05-08" }, NOW),
    ).toBe("month");
  });

  it("returns 'all' for a non-matching custom range", () => {
    expect(
      filterFromRange({ from: "2025-12-01", to: "2025-12-31" }, NOW),
    ).toBe("all");
  });
});
