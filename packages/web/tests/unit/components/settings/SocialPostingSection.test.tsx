import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { SocialPostingSection } from "../../../../src/components/settings/SocialPostingSection";
import * as api from "../../../../src/api/socialTestPost";

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("SocialPostingSection", () => {
  it("both platforms unconfigured → both pills show 'Not configured', both buttons disabled", async () => {
    vi.spyOn(api, "getSocialStatus").mockResolvedValue({
      linkedin: { configured: false },
      twitter: { configured: false },
    });

    renderWithClient(<SocialPostingSection />);

    await waitFor(() => {
      expect(screen.getAllByText("Not configured")).toHaveLength(2);
    });
    const buttons = screen.getAllByRole("button", { name: /send test post/i });
    expect(buttons).toHaveLength(2);
    for (const btn of buttons) {
      expect(btn.hasAttribute("disabled")).toBe(true);
    }
  });

  it("LinkedIn configured, X not → LinkedIn button enabled, X disabled", async () => {
    vi.spyOn(api, "getSocialStatus").mockResolvedValue({
      linkedin: { configured: true },
      twitter: { configured: false },
    });

    renderWithClient(<SocialPostingSection />);

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeTruthy();
    });

    const linkedinRow = screen.getByTestId("social-row-linkedin");
    const twitterRow = screen.getByTestId("social-row-twitter");
    const liBtn = within(linkedinRow).getByRole("button", {
      name: /send test post/i,
    });
    const xBtn = within(twitterRow).getByRole("button", {
      name: /send test post/i,
    });
    expect(liBtn.hasAttribute("disabled")).toBe(false);
    expect(xBtn.hasAttribute("disabled")).toBe(true);
  });

  it("click LinkedIn → polled posted with LinkedIn URN → renders 'Posted' link to feed/update URL", async () => {
    vi.spyOn(api, "getSocialStatus").mockResolvedValue({
      linkedin: { configured: true },
      twitter: { configured: false },
    });
    vi.spyOn(api, "startSocialTestPost").mockResolvedValue({
      requestId: "req-1",
    });
    const getResult = vi.spyOn(api, "getSocialTestPostResult");
    getResult.mockResolvedValueOnce({ status: "pending" });
    getResult.mockResolvedValueOnce({
      status: "posted",
      permalink: "urn:li:share:123",
    });

    renderWithClient(
      <SocialPostingSection pollIntervalMs={5} pollTimeoutMs={2000} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeTruthy();
    });

    const linkedinRow = screen.getByTestId("social-row-linkedin");
    fireEvent.click(
      within(linkedinRow).getByRole("button", { name: /send test post/i }),
    );

    await waitFor(
      () => {
        const result = screen.getByTestId("social-result-linkedin");
        expect(result.textContent).toMatch(/Posted/);
      },
      { timeout: 2000 },
    );
    const link = within(
      screen.getByTestId("social-result-linkedin"),
    ).getByRole("link");
    expect(link.getAttribute("href")).toBe(
      "https://www.linkedin.com/feed/update/urn:li:share:123",
    );
  });

  it("click LinkedIn → poll returns failed with error → row shows 'Failed: http_402'", async () => {
    vi.spyOn(api, "getSocialStatus").mockResolvedValue({
      linkedin: { configured: true },
      twitter: { configured: false },
    });
    vi.spyOn(api, "startSocialTestPost").mockResolvedValue({
      requestId: "req-2",
    });
    vi.spyOn(api, "getSocialTestPostResult").mockResolvedValue({
      status: "failed",
      error: "http_402",
    });

    renderWithClient(
      <SocialPostingSection pollIntervalMs={5} pollTimeoutMs={2000} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeTruthy();
    });

    const linkedinRow = screen.getByTestId("social-row-linkedin");
    fireEvent.click(
      within(linkedinRow).getByRole("button", { name: /send test post/i }),
    );

    await waitFor(
      () => {
        expect(
          screen.getByTestId("social-result-linkedin").textContent,
        ).toMatch(/Failed: http_402/);
      },
      { timeout: 2000 },
    );
  });

  it("click LinkedIn → poll always pending → after timeout row shows 'Timed out'", async () => {
    vi.spyOn(api, "getSocialStatus").mockResolvedValue({
      linkedin: { configured: true },
      twitter: { configured: false },
    });
    vi.spyOn(api, "startSocialTestPost").mockResolvedValue({
      requestId: "req-3",
    });
    vi.spyOn(api, "getSocialTestPostResult").mockResolvedValue({
      status: "pending",
    });

    renderWithClient(
      <SocialPostingSection pollIntervalMs={5} pollTimeoutMs={50} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeTruthy();
    });

    const linkedinRow = screen.getByTestId("social-row-linkedin");
    fireEvent.click(
      within(linkedinRow).getByRole("button", { name: /send test post/i }),
    );

    await waitFor(
      () => {
        expect(
          screen.getByTestId("social-result-linkedin").textContent,
        ).toMatch(/Timed out/);
      },
      { timeout: 2000 },
    );
  });

  it("permalink rendering: x.com URL is used as-is", async () => {
    vi.spyOn(api, "getSocialStatus").mockResolvedValue({
      linkedin: { configured: false },
      twitter: { configured: true },
    });
    vi.spyOn(api, "startSocialTestPost").mockResolvedValue({
      requestId: "req-4",
    });
    vi.spyOn(api, "getSocialTestPostResult").mockResolvedValue({
      status: "posted",
      permalink: "https://x.com/foo/status/42",
    });

    renderWithClient(
      <SocialPostingSection pollIntervalMs={5} pollTimeoutMs={2000} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeTruthy();
    });

    const twitterRow = screen.getByTestId("social-row-twitter");
    fireEvent.click(
      within(twitterRow).getByRole("button", { name: /send test post/i }),
    );

    await waitFor(
      () => {
        const link = within(
          screen.getByTestId("social-result-twitter"),
        ).getByRole("link");
        expect(link.getAttribute("href")).toBe("https://x.com/foo/status/42");
      },
      { timeout: 2000 },
    );
  });
});
