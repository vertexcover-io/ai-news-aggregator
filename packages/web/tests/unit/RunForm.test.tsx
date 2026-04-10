import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { RunForm } from "../../src/components/RunForm";

vi.mock("../../src/api/runs", () => ({
  submitRun: vi.fn(),
}));

vi.mock("../../src/api/profiles", () => ({
  fetchProfiles: vi.fn(),
}));

import { submitRun } from "../../src/api/runs";
import { fetchProfiles } from "../../src/api/profiles";

function renderWithClient(ui: ReactElement): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(ui, { wrapper });
}

describe("RunForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchProfiles).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows error when no sources are enabled (REQ-106)", async () => {
    const onSubmitted = vi.fn();
    renderWithClient(<RunForm onSubmitted={onSubmitted} />);

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

    renderWithClient(<RunForm onSubmitted={onSubmitted} />);
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    expect(onSubmitted).toHaveBeenCalledWith("run-123");
  });

  it("submits a web-only payload when HN is disabled and a web source is filled in", async () => {
    const onSubmitted = vi.fn();
    vi.mocked(submitRun).mockResolvedValueOnce({ runId: "run-web" });

    renderWithClient(<RunForm onSubmitted={onSubmitted} />);

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
    renderWithClient(<RunForm onSubmitted={onSubmitted} />);

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

  it("renders profile dropdown with 'No profile' plus fetched profiles (REQ-080)", async () => {
    vi.mocked(fetchProfiles).mockResolvedValueOnce(["aman", "ritesh"]);
    renderWithClient(<RunForm onSubmitted={vi.fn()} />);

    const select = await screen.findByLabelText<HTMLSelectElement>(/profile/i);
    await waitFor(() => {
      expect(select.options).toHaveLength(3);
    });
    expect(select.options[0].textContent).toBe("No profile");
    expect(select.options[0].value).toBe("");
    expect(select.options[1].value).toBe("aman");
    expect(select.options[1].textContent).toBe("aman");
    expect(select.options[2].value).toBe("ritesh");
    expect(select.options[2].textContent).toBe("ritesh");
  });

  it("submits profileName: null when 'No profile' is selected (REQ-081)", async () => {
    vi.mocked(fetchProfiles).mockResolvedValueOnce(["aman"]);
    vi.mocked(submitRun).mockResolvedValueOnce({ runId: "run-np" });

    renderWithClient(<RunForm onSubmitted={vi.fn()} />);
    const select = await screen.findByLabelText<HTMLSelectElement>(/profile/i);
    await waitFor(() => {
      expect(select.options).toHaveLength(2);
    });

    // Default is "" (No profile); submit as-is.
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    const payload = vi.mocked(submitRun).mock.calls[0][0];
    expect(payload.profileName).toBeNull();
  });

  it("submits profileName with selected profile string (REQ-082)", async () => {
    vi.mocked(fetchProfiles).mockResolvedValueOnce(["aman", "ritesh"]);
    vi.mocked(submitRun).mockResolvedValueOnce({ runId: "run-aman" });

    renderWithClient(<RunForm onSubmitted={vi.fn()} />);
    const select = await screen.findByLabelText<HTMLSelectElement>(/profile/i);
    await waitFor(() => {
      expect(select.options).toHaveLength(3);
    });

    fireEvent.change(select, { target: { value: "aman" } });
    expect(select.value).toBe("aman");

    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    const payload = vi.mocked(submitRun).mock.calls[0][0];
    expect(payload.profileName).toBe("aman");
  });

  it("shows only 'No profile' when fetched profiles is empty; still submittable (EDGE-017)", async () => {
    vi.mocked(fetchProfiles).mockResolvedValueOnce([]);
    vi.mocked(submitRun).mockResolvedValueOnce({ runId: "run-empty" });

    renderWithClient(<RunForm onSubmitted={vi.fn()} />);
    const select = await screen.findByLabelText<HTMLSelectElement>(/profile/i);

    await waitFor(() => {
      expect(select.disabled).toBe(false);
    });
    expect(select.options).toHaveLength(1);
    expect(select.options[0].textContent).toBe("No profile");
    expect(select.options[0].value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(submitRun).toHaveBeenCalledTimes(1);
    });
    const payload = vi.mocked(submitRun).mock.calls[0][0];
    expect(payload.profileName).toBeNull();
  });
});
