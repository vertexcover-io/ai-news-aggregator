import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactElement } from "react";
import { ScheduleSection } from "../../../../src/components/settings/ScheduleSection";
import {
  settingsFormSchema,
  type SettingsFormValues,
} from "../../../../src/pages/settingsSchema";

// VS-6 regression — Stage-5 finding 2026-05-04.
//
// `Intl.supportedValuesOf("timeZone")` returns canonical IANA names only
// (e.g. "Etc/UTC", "Atlantic/Reykjavik") and does NOT include the alias
// "UTC". The persisted DB schema for `schedule_timezone` uses "UTC".
// Without the alias being included as a SelectItem, Radix Select clears
// its controlled value to "" silently when it can't find a matching item,
// which makes `z.string().min(1)` reject and the entire Save flow no-op.
//
// This test renders the ScheduleSection with `scheduleTimezone: "UTC"`
// and asserts the option is reachable (not stripped from the list).

interface HarnessProps {
  initialTz: string;
}

function Harness({ initialTz }: HarnessProps): ReactElement {
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      topN: 10,
      halfLifeHours: null,
      hnEnabled: false,
      hnConfig: null,
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      scheduleTime: "09:00",
      scheduleTimezone: initialTz,
      scheduleEnabled: false,
    },
  });
  return <ScheduleSection register={form.register} control={form.control} />;
}

describe("ScheduleSection — UTC alias regression", () => {
  afterEach(() => {
    cleanup();
  });

  it("VS-6: renders with scheduleTimezone='UTC' (alias not stripped by Intl.supportedValuesOf)", () => {
    render(<Harness initialTz="UTC" />);
    // Radix Select renders the current value's label inside the trigger.
    // After our fix, "UTC" is in the option list, so the select keeps the
    // controlled value rather than clearing it.
    const trigger = screen.getByRole("combobox", { name: /timezone/i });
    expect(trigger.textContent).toContain("UTC");
  });

  it("VS-6: renders with a canonical IANA timezone present in the option list", () => {
    // Use a timezone present in both Intl.supportedValuesOf (when available)
    // and the FALLBACK_TIMEZONES list, so the test works in both jsdom
    // (which lacks Intl.supportedValuesOf and falls back) and real browsers.
    render(<Harness initialTz="Asia/Tokyo" />);
    const trigger = screen.getByRole("combobox", { name: /timezone/i });
    expect(trigger.textContent).toContain("Asia/Tokyo");
  });
});
