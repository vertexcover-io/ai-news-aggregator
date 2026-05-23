import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactElement, ReactNode } from "react";
import { DEFAULT_SHORTLIST_PROMPT } from "@newsletter/shared/constants";
import { ShortlistPromptSection } from "../../../../src/components/settings/ShortlistPromptSection";
import {
  settingsFormSchema,
  type SettingsFormValues,
} from "../../../../src/pages/settingsSchema";

interface HarnessProps {
  initial?: string;
  children?: ReactNode;
}

function Harness({ initial = "hello prompt" }: HarnessProps): ReactElement {
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
      rankingPrompt: "seed ranking",
      shortlistPrompt: initial,
      shortlistSize: 30,
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
        <ShortlistPromptSection />
        <button type="submit">Submit</button>
      </form>
    </FormProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe("ShortlistPromptSection", () => {
  it("renders the textarea with the bound value", () => {
    render(<Harness initial="abc" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Shortlist prompt");
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe("abc");
  });

  it("updates the character count as the user types", () => {
    render(<Harness initial="abc" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Shortlist prompt");
    const count = screen.getByTestId("shortlist-prompt-char-count");
    expect(count.textContent).toBe("3 / 20000");
    fireEvent.change(textarea, { target: { value: "hello" } });
    expect(count.textContent).toBe("5 / 20000");
  });

  it("resets to DEFAULT_SHORTLIST_PROMPT when 'Reset to default' is clicked", () => {
    render(<Harness initial="custom" />);
    const button = screen.getByRole("button", { name: /reset to default/i });
    fireEvent.click(button);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Shortlist prompt");
    expect(textarea.value).toBe(DEFAULT_SHORTLIST_PROMPT);
  });

  it("shows a validation error when the field is empty on submit", async () => {
    render(<Harness initial="seed" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Shortlist prompt");
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    const err = await screen.findByTestId("shortlist-prompt-error");
    expect(err.textContent).toMatch(/required/i);
  });
});
