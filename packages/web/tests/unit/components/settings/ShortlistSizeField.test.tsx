import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactElement } from "react";
import { ShortlistSizeField } from "../../../../src/components/settings/ShortlistSizeField";
import {
  settingsFormSchema,
  type SettingsFormValues,
} from "../../../../src/pages/settingsSchema";

function Harness({ initial = 30 }: { initial?: number }): ReactElement {
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      topN: 10,
      halfLifeHours: 24,
      hnEnabled: true,
      hnConfig: { sinceDays: 1 },
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      webSearchEnabled: false,
      webSearchConfig: null,
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: "https://us.i.posthog.com",
      pipelineTime: "07:00",
      emailTime: "07:30",
      linkedinTime: "07:45",
      twitterTime: "08:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
      emailEnabled: true,
      linkedinEnabled: true,
      twitterPostEnabled: true,
      autoReview: false,
      rankingPrompt: "seed",
      shortlistPrompt: "seed",
      shortlistSize: initial,
    },
  });

  return (
    <FormProvider {...form}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit(
            () => undefined,
            () => undefined,
          )(e);
        }}
      >
        <ShortlistSizeField />
        <button type="submit">Submit</button>
      </form>
    </FormProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe("ShortlistSizeField", () => {
  it("renders a numeric input bound to shortlistSize with the current value", () => {
    render(<Harness initial={42} />);
    const input = screen.getByLabelText<HTMLInputElement>("Shortlist size");
    expect(input).toBeTruthy();
    expect(input.type).toBe("number");
    expect(input.value).toBe("42");
  });

  it("declares min=5 and max=100 constraints on the input", () => {
    render(<Harness initial={30} />);
    const input = screen.getByLabelText<HTMLInputElement>("Shortlist size");
    expect(input.min).toBe("5");
    expect(input.max).toBe("100");
  });

  it("registers shortlistSize as a numeric field with valueAsNumber", () => {
    render(<Harness initial={42} />);
    const input = screen.getByLabelText<HTMLInputElement>("Shortlist size");
    expect(input.getAttribute("name")).toBe("shortlistSize");
    expect(input.step).toBe("1");
  });
});

describe("settingsFormSchema shortlistSize validation (REQ-051)", () => {
  function basePayload(): unknown {
    return {
      topN: 10,
      halfLifeHours: 24,
      hnEnabled: true,
      hnConfig: { sinceDays: 1 },
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      webSearchEnabled: false,
      webSearchConfig: null,
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: "https://us.i.posthog.com",
      pipelineTime: "07:00",
      emailTime: "07:30",
      linkedinTime: "07:45",
      twitterTime: "08:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
      emailEnabled: true,
      linkedinEnabled: true,
      twitterPostEnabled: true,
      autoReview: false,
      rankingPrompt: "seed",
      shortlistPrompt: "seed",
    };
  }

  it("rejects shortlistSize below 5", () => {
    const result = settingsFormSchema.safeParse({
      ...(basePayload() as object),
      shortlistSize: 3,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.path.includes("shortlistSize"),
      );
      expect(issue?.message).toMatch(/at least 5/i);
    }
  });

  it("rejects shortlistSize above 100", () => {
    const result = settingsFormSchema.safeParse({
      ...(basePayload() as object),
      shortlistSize: 500,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.path.includes("shortlistSize"),
      );
      expect(issue?.message).toMatch(/at most 100/i);
    }
  });

  it("rejects non-integer shortlistSize", () => {
    const result = settingsFormSchema.safeParse({
      ...(basePayload() as object),
      shortlistSize: 12.5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.path.includes("shortlistSize"),
      );
      expect(issue?.message).toMatch(/integer/i);
    }
  });

  it("accepts shortlistSize=30 (default)", () => {
    const result = settingsFormSchema.safeParse({
      ...(basePayload() as object),
      shortlistSize: 30,
    });
    expect(result.success).toBe(true);
  });
});
