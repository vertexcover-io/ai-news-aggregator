import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { CollectorHealthResult } from "@newsletter/shared/types";
import { CollectorHealthModal } from "../../../../src/components/settings/CollectorHealthModal";

afterEach(cleanup);

function makeResult(
  overrides: Partial<CollectorHealthResult> = {},
): CollectorHealthResult {
  return {
    collector: "hn",
    status: "healthy",
    trigger: "manual",
    checkedAt: "2026-06-03T10:00:00Z",
    durationMs: 1234,
    reason: null,
    detail: null,
    ...overrides,
  };
}

describe("CollectorHealthModal — REQ-018, EDGE-006", () => {
  it("REQ-018: renders status pill for healthy result", () => {
    render(
      <CollectorHealthModal
        open={true}
        onOpenChange={() => undefined}
        result={makeResult({ status: "healthy" })}
      />,
    );
    expect(within(screen.getByTestId("status-pill")).getByText("Healthy")).toBeTruthy();
  });

  it("REQ-018: renders status pill for failed result with reason", () => {
    render(
      <CollectorHealthModal
        open={true}
        onOpenChange={() => undefined}
        result={makeResult({ status: "failed", reason: "Connection refused" })}
      />,
    );
    expect(within(screen.getByTestId("status-pill")).getByText("Failed")).toBeTruthy();
    expect(screen.getByTestId("failure-reason").textContent).toBe("Connection refused");
  });

  it("EDGE-006: renders 'Never checked' for status=never", () => {
    render(
      <CollectorHealthModal
        open={true}
        onOpenChange={() => undefined}
        result={makeResult({
          status: "never",
          trigger: null,
          checkedAt: null,
          durationMs: null,
          reason: null,
        })}
      />,
    );
    expect(within(screen.getByTestId("status-pill")).getByText("Never checked")).toBeTruthy();
    expect(screen.queryByTestId("checked-at")).toBeNull();
    expect(screen.queryByTestId("duration")).toBeNull();
  });

  it("REQ-018: renders checkedAt (relative) and durationMs when present", () => {
    render(
      <CollectorHealthModal
        open={true}
        onOpenChange={() => undefined}
        result={makeResult({
          status: "healthy",
          checkedAt: "2026-06-03T10:00:00Z",
          durationMs: 750,
        })}
      />,
    );
    expect(screen.getByTestId("checked-at")).toBeTruthy();
    expect(screen.getByTestId("duration").textContent).toBe("750ms");
  });

  it("REQ-018: formats durationMs >= 1000 as seconds", () => {
    render(
      <CollectorHealthModal
        open={true}
        onOpenChange={() => undefined}
        result={makeResult({
          status: "healthy",
          checkedAt: "2026-06-03T10:00:00Z",
          durationMs: 2500,
        })}
      />,
    );
    expect(screen.getByTestId("duration").textContent).toBe("2.5s");
  });

  it("REQ-018: renders running spinner for status=running", () => {
    render(
      <CollectorHealthModal
        open={true}
        onOpenChange={() => undefined}
        result={makeResult({
          status: "running",
          trigger: "manual",
          checkedAt: "2026-06-03T10:00:00Z",
          durationMs: null,
        })}
      />,
    );
    expect(within(screen.getByTestId("status-pill")).getByText("Running")).toBeTruthy();
  });

  it("returns null when result prop is null", () => {
    const { container } = render(
      <CollectorHealthModal
        open={true}
        onOpenChange={() => undefined}
        result={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
