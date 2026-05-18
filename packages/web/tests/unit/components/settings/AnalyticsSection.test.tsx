import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactElement } from "react";
import { AnalyticsSection } from "../../../../src/components/settings/AnalyticsSection";
import {
  settingsFormSchema,
  type SettingsFormValues,
} from "../../../../src/pages/settingsSchema";

function Harness(): ReactElement {
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      topN: 10,
      halfLifeHours: null,
      hnEnabled: true,
      hnConfig: { sinceDays: 1 },
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: "https://us.i.posthog.com",
      scheduleTime: "09:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
    },
  });
  return (
    <AnalyticsSection register={form.register} control={form.control} />
  );
}

afterEach(() => {
  cleanup();
});

describe("AnalyticsSection", () => {
  it("renders the PostHog settings controls", () => {
    render(<Harness />);
    expect(screen.getByText("Analytics")).toBeTruthy();
    expect(screen.getByLabelText("Enable PostHog analytics")).toBeTruthy();
    expect(screen.getByLabelText("Project token")).toBeTruthy();
    expect(screen.getByLabelText("Host")).toBeTruthy();
    expect(screen.getByText(/public PostHog project token/i)).toBeTruthy();
  });
});

