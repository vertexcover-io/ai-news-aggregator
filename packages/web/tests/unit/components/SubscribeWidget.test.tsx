import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SubscribeWidget } from "../../../src/components/SubscribeWidget";

vi.mock("../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../src/lib/analytics.js", () => ({
  captureBrowserEvent: vi.fn(),
}));

import { postSubscribe } from "../../../src/api/subscribe";
const mockPostSubscribe = vi.mocked(postSubscribe);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom in this project lacks localStorage.clear in some configs — safe to ignore in cleanup.
  }
});

function renderWidget(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <SubscribeWidget />
    </MemoryRouter>,
  );
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
});
