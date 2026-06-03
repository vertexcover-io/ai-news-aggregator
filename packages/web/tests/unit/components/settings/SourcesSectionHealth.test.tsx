import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { ReactElement } from "react";
import type { CollectorHealthSnapshot } from "@newsletter/shared/types";
import { SourcesSection } from "../../../../src/components/settings/SourcesSection";
import type { SettingsFormValues } from "../../../../src/pages/settingsSchema";

// Mock the hook so we control snapshot state
vi.mock("../../../../src/hooks/useCollectorHealth", () => ({
  useCollectorHealth: vi.fn(),
  useCollectorHealthTrigger: vi.fn(),
}));

import {
  useCollectorHealth,
  useCollectorHealthTrigger,
} from "../../../../src/hooks/useCollectorHealth";

const mockTrigger = vi.fn();

function setupMocks(snap?: CollectorHealthSnapshot): void {
  vi.mocked(useCollectorHealth).mockReturnValue({
    data: snap,
    isLoading: false,
    isFetched: true,
  } as ReturnType<typeof useCollectorHealth>);
  vi.mocked(useCollectorHealthTrigger).mockReturnValue({
    trigger: mockTrigger,
    isPending: false,
  });
}

function TestWrapper(): ReactElement {
  const { control, register, setValue } = useForm<SettingsFormValues>({
    defaultValues: {
      topN: 10,
      halfLifeHours: null,
      hnEnabled: false,
      hnConfig: null,
      redditEnabled: false,
      redditConfig: null,
      webEnabled: true,
      webConfig: {
        sources: [],
        maxItems: 10,
        sinceDays: 7,
      },
      twitterEnabled: false,
      twitterConfig: null,
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
      scheduleTime: "09:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
    },
  });
  return (
    <SourcesSection control={control} register={register} setValue={setValue} />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SourcesSection — collector health controls (REQ-017)", () => {
  it("REQ-017: renders a Check button for each collector row", () => {
    setupMocks();
    render(<TestWrapper />);

    // Each of the five source rows should have a Check button
    const checkButtons = screen.getAllByRole("button", { name: /^check /i });
    // There are 5 source rows (HN, Reddit, Web, Twitter, Web Search)
    expect(checkButtons.length).toBeGreaterThanOrEqual(5);
  });

  it("REQ-017: renders a Check all button in the section header", () => {
    setupMocks();
    render(<TestWrapper />);

    const checkAllButton = screen.getByTestId("check-all-button");
    expect(checkAllButton).toBeTruthy();
    expect(checkAllButton.textContent?.toLowerCase()).toContain("check all");
  });

  it("REQ-017: clicking Check for Hacker News calls trigger with 'hn'", () => {
    setupMocks();
    render(<TestWrapper />);

    const hnCheckButton = screen.getByRole("button", { name: /check hacker news/i });
    fireEvent.click(hnCheckButton);

    expect(mockTrigger).toHaveBeenCalledWith("hn");
  });

  it("REQ-017: clicking Check for Web (blog listings) calls trigger with 'blog'", () => {
    setupMocks();
    render(<TestWrapper />);

    const webCheckButton = screen.getByRole("button", { name: /check web \(blog listings\)/i });
    fireEvent.click(webCheckButton);

    // Web row must map to 'blog' collector id, not 'web'
    expect(mockTrigger).toHaveBeenCalledWith("blog");
  });

  it("REQ-017: clicking Check all calls trigger with no argument", () => {
    setupMocks();
    render(<TestWrapper />);

    const checkAllButton = screen.getByTestId("check-all-button");
    fireEvent.click(checkAllButton);

    expect(mockTrigger).toHaveBeenCalledWith(undefined);
  });

  it("REQ-017: clicking Check for Reddit calls trigger with 'reddit'", () => {
    setupMocks();
    render(<TestWrapper />);

    const redditCheckButton = screen.getByRole("button", { name: /check reddit/i });
    fireEvent.click(redditCheckButton);

    expect(mockTrigger).toHaveBeenCalledWith("reddit");
  });

  it("REQ-017: clicking Check for Twitter / X calls trigger with 'twitter'", () => {
    setupMocks();
    render(<TestWrapper />);

    const twitterCheckButton = screen.getByRole("button", { name: /check twitter \/ x/i });
    fireEvent.click(twitterCheckButton);

    expect(mockTrigger).toHaveBeenCalledWith("twitter");
  });
});
