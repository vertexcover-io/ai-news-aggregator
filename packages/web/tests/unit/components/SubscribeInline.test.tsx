import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SubscribeInline } from "../../../src/components/archive-listing/SubscribeInline";

vi.mock("../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../src/lib/analytics", () => ({
  captureBrowserEvent: vi.fn(),
}));

import { postSubscribe } from "../../../src/api/subscribe";
import { captureBrowserEvent } from "../../../src/lib/analytics";
const mockPostSubscribe = vi.mocked(postSubscribe);
const mockCaptureBrowserEvent = vi.mocked(captureBrowserEvent);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom in this project lacks localStorage.clear in some configs — safe to ignore in cleanup.
  }
});

function renderInline(props: { variant?: "hero" | "interlude" } = {}): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <SubscribeInline variant={props.variant ?? "hero"} />
    </MemoryRouter>,
  );
}

describe("SubscribeInline", () => {
  it("renders pill email input + Subscribe button", () => {
    renderInline();
    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /subscribe/i })).toBeTruthy();
  });

  it("renders consent checkbox", () => {
    renderInline();
    expect(screen.getByRole("checkbox")).toBeTruthy();
  });

  it("renders the meta line for the hero variant", () => {
    renderInline({ variant: "hero" });
    expect(
      screen.getByText(/Free .*One email each weekday .*Unsubscribe anytime/i),
    ).toBeTruthy();
  });

  it("renders an interlude title for the interlude variant", () => {
    renderInline({ variant: "interlude" });
    expect(screen.getByText(/Get the daily AI digest/i)).toBeTruthy();
  });

  it("does not call postSubscribe without consent", async () => {
    renderInline();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "x@y.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));
    await waitFor(() => {
      expect(mockPostSubscribe).not.toHaveBeenCalled();
    });
  });

  it("calls postSubscribe when both email and consent are provided", async () => {
    mockPostSubscribe.mockResolvedValueOnce({ ok: true });
    renderInline();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "x@y.com" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));
    await waitFor(() => {
      expect(mockPostSubscribe).toHaveBeenCalledWith("x@y.com");
    });
    expect(mockCaptureBrowserEvent).toHaveBeenCalledWith(
      "subscribe_form_submitted",
      { source: "hero" },
    );
    expect(mockCaptureBrowserEvent).toHaveBeenCalledWith(
      "subscribe_form_succeeded",
      { source: "hero" },
    );
  });

  it("shows success state after successful submit", async () => {
    mockPostSubscribe.mockResolvedValueOnce({ ok: true });
    renderInline();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "x@y.com" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));
    await waitFor(() => {
      expect(screen.getByText(/check your inbox/i)).toBeTruthy();
    });
  });

  it("captures a safe error code when submit fails", async () => {
    mockPostSubscribe.mockResolvedValueOnce({ error: "network_error" });
    renderInline({ variant: "interlude" });
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "x@y.com" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));
    await waitFor(() => {
      expect(mockCaptureBrowserEvent).toHaveBeenCalledWith(
        "subscribe_form_failed",
        { source: "interlude", error_code: "network_error" },
      );
    });
  });
});
