import { describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { ReactElement } from "react";
import { RankingSection } from "../../../../src/components/settings/RankingSection";
import type { SettingsFormValues } from "../../../../src/pages/settingsSchema";

function Harness({
  initial = "",
}: {
  initial?: string;
}): ReactElement {
  const form = useForm<SettingsFormValues>({
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
      scheduleTime: "07:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
      rankingWorkflow: initial,
    },
  });
  return (
    <RankingSection
      register={form.register}
      control={form.control}
      setValue={form.setValue}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("RankingSection", () => {
  it("VS-10: typing updates the textarea value", () => {
    render(<Harness />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>(
      /editorial workflow/i,
    );
    fireEvent.change(textarea, { target: { value: "boost agent stuff" } });
    expect(textarea.value).toBe("boost agent stuff");
  });

  it("VS-10: 'Reset to default' empties the textarea", () => {
    render(<Harness initial="some custom workflow text" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>(
      /editorial workflow/i,
    );
    expect(textarea.value).toBe("some custom workflow text");
    fireEvent.click(screen.getByRole("button", { name: /reset to default/i }));
    expect(textarea.value).toBe("");
  });

  it("VS-11: counter updates as the user types", () => {
    render(<Harness />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>(
      /editorial workflow/i,
    );
    const counter = screen.getByTestId("ranking-workflow-counter");
    expect(counter.textContent).toBe("0 / 8000");

    fireEvent.change(textarea, { target: { value: "hello" } });
    expect(counter.textContent).toBe("5 / 8000");
  });

  it("VS-11: counter turns red when over 8000 characters", () => {
    render(<Harness initial={"x".repeat(8001)} />);
    const counter = screen.getByTestId("ranking-workflow-counter");
    expect(counter.className).toContain("text-destructive");
  });

  it("VS-11: counter is muted when within limit", () => {
    render(<Harness initial="short" />);
    const counter = screen.getByTestId("ranking-workflow-counter");
    expect(counter.className).toContain("text-muted-foreground");
    expect(counter.className).not.toContain("text-destructive");
  });
});
