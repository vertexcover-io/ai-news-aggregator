import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FailuresList } from "../../../../src/components/observability/FailuresList";
import { makeLog } from "./fixtures";

afterEach(() => {
  cleanup();
});

describe("FailuresList (REQ-038, EDGE-007)", () => {
  it("REQ-038: renders the empty state when there are no failures", () => {
    render(<FailuresList failures={[]} />);
    expect(screen.getByTestId("failures-empty")).toBeTruthy();
    expect(screen.queryByTestId("failure-card")).toBeNull();
  });

  it("renders a card per failure with context tags", () => {
    render(
      <FailuresList
        failures={[
          makeLog({
            id: 3,
            level: "error",
            source: "twitter",
            event: "source.failed",
            message: "TwitterAuthError: auth failed",
            context: { errorClass: "auth", retries: 2, fatal: false },
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("failure-card")).toBeTruthy();
    expect(screen.getByText("source: twitter")).toBeTruthy();
    expect(screen.getByText("class: auth")).toBeTruthy();
    expect(screen.getByText("non-fatal")).toBeTruthy();
  });

  it("EDGE-007: a very long message is truncated and expands on click", () => {
    const long = `FetchTimeout: ${"x".repeat(800)}`;
    render(
      <FailuresList
        failures={[makeLog({ id: 9, level: "error", message: long })]}
      />,
    );
    const card = screen.getByTestId("failure-card");
    expect(card.textContent).toContain("…");
    expect(card.textContent?.length ?? 0).toBeLessThan(long.length + 100);
    fireEvent.click(screen.getByTestId("failure-expand"));
    expect(screen.getByTestId("failure-card").textContent).toContain(
      "x".repeat(800),
    );
  });
});
