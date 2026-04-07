import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { RunForm } from "../../src/components/RunForm";

vi.mock("../../src/api/runs", () => ({
  submitRun: vi.fn(),
}));

import { submitRun } from "../../src/api/runs";

describe("RunForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows error when no sources are enabled (REQ-106)", async () => {
    const onSubmitted = vi.fn();
    render(<RunForm onSubmitted={onSubmitted} />);

    // Uncheck HN which is enabled by default.
    const hnCheckbox = screen.getByLabelText(/hacker news/i);
    fireEvent.click(hnCheckbox);
    expect((hnCheckbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toMatch(
        /enable at least one source/i,
      );
    });
    expect(submitRun).not.toHaveBeenCalled();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("submits payload with HN enabled by default", async () => {
    const onSubmitted = vi.fn();
    vi.mocked(submitRun).mockResolvedValueOnce({ runId: "run-123" });

    render(<RunForm onSubmitted={onSubmitted} />);
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    expect(onSubmitted).toHaveBeenCalledWith("run-123");
  });
});
