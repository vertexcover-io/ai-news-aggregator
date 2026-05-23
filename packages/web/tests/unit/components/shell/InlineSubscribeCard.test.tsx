import { describe, expect, it, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { InlineSubscribeCard } from "../../../../src/components/shell/InlineSubscribeCard";

vi.mock("../../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../../src/lib/analytics", () => ({
  captureBrowserEvent: vi.fn(),
}));

import { postSubscribe } from "../../../../src/api/subscribe";
const mockPostSubscribe = vi.mocked(postSubscribe);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* localStorage not available in this jsdom build */
  }
});

function renderCard(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <InlineSubscribeCard />
    </MemoryRouter>,
  );
}

describe("InlineSubscribeCard", () => {
  it("renders the serif headline 'Read AgentLoop every morning.'", () => {
    renderCard();
    expect(screen.getByText(/Read AgentLoop every morning/i)).toBeTruthy();
  });

  it("renders the mono sub-line 'What we read so you don't have to. 7am daily, free.'", () => {
    renderCard();
    expect(
      screen.getByText(/what we read so you don't have to.*7am daily.*free/i),
    ).toBeTruthy();
  });

  it("renders an email input and SUBSCRIBE button", () => {
    renderCard();
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /subscribe/i })).toBeTruthy();
  });

  it("the root element has data-section='inline-subscribe'", () => {
    const { container } = renderCard();
    const root = container.querySelector('[data-section="inline-subscribe"]');
    expect(root).not.toBeNull();
  });

  it("the form has data-purpose='subscribe'", () => {
    const { container } = renderCard();
    const form = container.querySelector('form[data-purpose="subscribe"]');
    expect(form).not.toBeNull();
  });

  it("calls postSubscribe with the entered email on submit", async () => {
    mockPostSubscribe.mockResolvedValueOnce({ ok: true });
    renderCard();
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "x@y.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));
    await waitFor(() => {
      expect(mockPostSubscribe).toHaveBeenCalledWith("x@y.com");
    });
  });

  it("shows a success message after a successful submit", async () => {
    mockPostSubscribe.mockResolvedValueOnce({ ok: true });
    renderCard();
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "x@y.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));
    await waitFor(() => {
      expect(screen.getByText(/check your inbox/i)).toBeTruthy();
    });
  });

  it("shows an error message on failure", async () => {
    mockPostSubscribe.mockResolvedValueOnce({ error: "network_error" });
    renderCard();
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "x@y.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));
    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeTruthy();
    });
  });
});
