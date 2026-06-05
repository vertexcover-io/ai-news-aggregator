import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { InlineSubscribeCard } from "../../../../src/components/shell/InlineSubscribeCard";

vi.mock("../../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../../src/lib/analytics", () => ({
  captureBrowserEvent: vi.fn(),
}));

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
});
