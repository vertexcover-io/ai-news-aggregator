import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { SubscribeWidget } from "../../../src/components/SubscribeWidget";

vi.mock("../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../src/lib/analytics.js", () => ({
  captureBrowserEvent: vi.fn(),
}));

import { postSubscribe } from "../../../src/api/subscribe";
import { captureBrowserEvent } from "../../../src/lib/analytics.js";
const mockPostSubscribe = vi.mocked(postSubscribe);
const mockCaptureBrowserEvent = vi.mocked(captureBrowserEvent);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

function renderWidget(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <SubscribeWidget />
    </MemoryRouter>,
  );
}

function renderWidgetWithElement(ui: ReactElement): ReturnType<typeof render> {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("SubscribeWidget", () => {
  it("renders email input and checkbox", () => {
    renderWidget();
    expect(screen.getByPlaceholderText("Your email")).toBeTruthy();
    expect(screen.getByRole("checkbox")).toBeTruthy();
  });

  it("renders Subscribe button", () => {
    renderWidget();
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeTruthy();
  });

  it("submit with empty email does not call postSubscribe", async () => {
    renderWidget();
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    const button = screen.getByRole("button", { name: "Subscribe" });
    fireEvent.click(button);
    await waitFor(() => {
      expect(mockPostSubscribe).not.toHaveBeenCalled();
    });
  });

  it("submit without checkbox checked does not call postSubscribe", async () => {
    renderWidget();
    const emailInput = screen.getByPlaceholderText("Your email");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    const button = screen.getByRole("button", { name: "Subscribe" });
    fireEvent.click(button);
    await waitFor(() => {
      expect(mockPostSubscribe).not.toHaveBeenCalled();
    });
  });

  it("valid email + checked checkbox calls postSubscribe", async () => {
    mockPostSubscribe.mockResolvedValueOnce({ ok: true });
    renderWidget();
    const emailInput = screen.getByPlaceholderText("Your email");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    const button = screen.getByRole("button", { name: "Subscribe" });
    fireEvent.click(button);
    await waitFor(() => {
      expect(mockPostSubscribe).toHaveBeenCalledWith("test@example.com");
    });
    expect(mockCaptureBrowserEvent).toHaveBeenCalledWith(
      "subscribe_form_submitted",
      { source: "widget" },
    );
    expect(mockCaptureBrowserEvent).toHaveBeenCalledWith(
      "subscribe_form_succeeded",
      { source: "widget" },
    );
  });

  it("shows success message after successful submit", async () => {
    mockPostSubscribe.mockResolvedValueOnce({ ok: true });
    renderWidget();
    const emailInput = screen.getByPlaceholderText("Your email");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    await waitFor(() => {
      expect(
        screen.getByText("Check your inbox to confirm your subscription."),
      ).toBeTruthy();
    });
  });

  it("shows error message after failed submit", async () => {
    mockPostSubscribe.mockResolvedValueOnce({ error: "request_failed" });
    renderWidgetWithElement(<SubscribeWidget />);
    const emailInput = screen.getByPlaceholderText("Your email");
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    await waitFor(() => {
      expect(
        screen.getByText("Something went wrong. Please try again."),
      ).toBeTruthy();
    });
    expect(mockCaptureBrowserEvent).toHaveBeenCalledWith(
      "subscribe_form_failed",
      { source: "widget", error_code: "request_failed" },
    );
  });
});
