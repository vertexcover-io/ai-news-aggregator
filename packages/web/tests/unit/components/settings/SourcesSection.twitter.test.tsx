import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactElement } from "react";
import { SourcesSection } from "../../../../src/components/settings/SourcesSection";
import {
  settingsFormSchema,
  type SettingsFormValues,
} from "../../../../src/pages/settingsSchema";

afterEach(() => {
  cleanup();
});

const DEFAULT_VALUES: SettingsFormValues = {
  topN: 10,
  halfLifeHours: null,
  hnConfig: null,
  redditConfig: null,
  webConfig: null,
  twitterConfig: {
    users: ["openai", "AnthropicAI"],
    listIds: [],
    maxPerSource: 50,
    sinceDays: 1,
  },
  scheduleTime: "07:00",
  scheduleTimezone: "UTC",
  scheduleEnabled: false,
};

function SourcesSectionWrapper({
  defaults,
  onSubmit,
}: {
  defaults: SettingsFormValues;
  onSubmit?: (values: SettingsFormValues) => void;
}): ReactElement {
  const { control, handleSubmit } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: defaults,
  });
  return (
    <form
      onSubmit={(e) => {
        void handleSubmit((v) => {
          onSubmit?.(v);
        })(e);
      }}
    >
      <SourcesSection control={control} />
      <button type="submit">Save</button>
    </form>
  );
}

describe("SourcesSection Twitter — REQ-060, REQ-061, REQ-062, EDGE-019", () => {
  // REQ-060: card renders all six required elements
  it("REQ-060: renders Twitter toggle, users editor, listIds editor, maxPerSource input, sinceDays input, and env-var notice when expanded", () => {
    render(<SourcesSectionWrapper defaults={DEFAULT_VALUES} />);

    // The switch is present (Twitter / X row)
    const toggle = screen.getByRole("switch", { name: "Twitter / X" });
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    // Expand the Twitter section by clicking the edit button in the Twitter row
    // The Twitter row's edit button is the last one (4th source row)
    const allEditBtns = screen.getAllByRole("button", { name: /edit/i });
    fireEvent.click(allEditBtns[allEditBtns.length - 1]);

    // env-var notice
    expect(
      screen.getByText("Requires TWITTER_COOKIES_JSON env var."),
    ).toBeTruthy();

    // users editor — "Add user" button present
    expect(screen.getByRole("button", { name: "Add user" })).toBeTruthy();

    // listIds editor — "Add list" button present
    expect(screen.getByRole("button", { name: "Add list" })).toBeTruthy();

    // maxPerSource numeric input
    expect(screen.getByLabelText("Max per source")).toBeTruthy();

    // sinceDays numeric input
    expect(screen.getByLabelText("Since (days)")).toBeTruthy();
  });

  // REQ-061: toggle off → form value null on submit
  it("REQ-061: toggling Twitter off sets twitterConfig to null on submit", async () => {
    const onSubmit = vi.fn();
    render(<SourcesSectionWrapper defaults={DEFAULT_VALUES} onSubmit={onSubmit} />);

    // toggle off
    const toggle = screen.getByRole("switch", { name: "Twitter / X" });
    fireEvent.click(toggle);

    // submit
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // value must be null — wait for async form submission
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    const submitted = onSubmit.mock.calls[0][0] as SettingsFormValues;
    expect(submitted.twitterConfig).toBeNull();
  });

  // REQ-062: round-trip — form hydrates from server canonical values; submit preserves them
  it("REQ-062: round-trip preserves canonical users and listIds", async () => {
    const canonical: SettingsFormValues = {
      ...DEFAULT_VALUES,
      twitterConfig: {
        users: ["openai"],
        listIds: ["1234567890"],
        maxPerSource: 50,
        sinceDays: 1,
      },
    };
    const onSubmit = vi.fn();
    render(<SourcesSectionWrapper defaults={canonical} onSubmit={onSubmit} />);

    // expand Twitter section
    const allEditBtns = screen.getAllByRole("button", { name: /edit/i });
    fireEvent.click(allEditBtns[allEditBtns.length - 1]);

    // The user input should show "openai"
    const userInput = screen.getByDisplayValue("openai");
    expect(userInput).toBeTruthy();

    // The list input should show "1234567890"
    const listInput = screen.getByDisplayValue("1234567890");
    expect(listInput).toBeTruthy();

    // submit without changes
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // wait for async form submission
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    const submitted = onSubmit.mock.calls[0][0] as SettingsFormValues;
    expect(submitted.twitterConfig?.users).toEqual(["openai"]);
    // listIds go through the zod transform on submit — "1234567890" → "1234567890"
    expect(submitted.twitterConfig?.listIds).toEqual(["1234567890"]);
  });

  // EDGE-019: API returns canonical numeric listId; form shows it as-is
  it("EDGE-019: form hydrates from canonical numeric listId and shows it unchanged", () => {
    const canonical: SettingsFormValues = {
      ...DEFAULT_VALUES,
      twitterConfig: {
        users: [],
        listIds: ["9876543210"],
        maxPerSource: 50,
        sinceDays: 1,
      },
    };
    render(<SourcesSectionWrapper defaults={canonical} />);

    // expand
    const allEditBtns = screen.getAllByRole("button", { name: /edit/i });
    fireEvent.click(allEditBtns[allEditBtns.length - 1]);

    // canonical ID shows in input
    expect(screen.getByDisplayValue("9876543210")).toBeTruthy();
  });
});
