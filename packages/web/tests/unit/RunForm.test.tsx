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

  it("submits a web-only payload when HN is disabled and a web source is filled in", async () => {
    const onSubmitted = vi.fn();
    vi.mocked(submitRun).mockResolvedValueOnce({ runId: "run-web" });

    render(<RunForm onSubmitted={onSubmitted} />);

    fireEvent.click(screen.getByLabelText(/hacker news/i));
    fireEvent.click(screen.getByLabelText(/web sources/i));

    fireEvent.change(screen.getByLabelText(/source 1 name/i), {
      target: { value: "Anthropic" },
    });
    fireEvent.change(screen.getByLabelText(/source 1 listing url/i), {
      target: { value: "https://www.anthropic.com/research" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    const payload = vi.mocked(submitRun).mock.calls[0][0];
    expect(payload.hn).toBeUndefined();
    expect(payload.reddit).toBeUndefined();
    expect(payload.web).toEqual({
      sources: [
        { name: "Anthropic", listingUrl: "https://www.anthropic.com/research" },
      ],
      maxItems: 10,
      sinceDays: 7,
    });
    expect(onSubmitted).toHaveBeenCalledWith("run-web");
  });

  it("rejects web submission when no source rows have both name and URL", async () => {
    const onSubmitted = vi.fn();
    render(<RunForm onSubmitted={onSubmitted} />);

    fireEvent.click(screen.getByLabelText(/hacker news/i));
    fireEvent.click(screen.getByLabelText(/web sources/i));

    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toMatch(
        /add at least one web source/i,
      );
    });
    expect(submitRun).not.toHaveBeenCalled();
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});
