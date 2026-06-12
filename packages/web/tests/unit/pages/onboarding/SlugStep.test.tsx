import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { useForm } from "react-hook-form";
import {
  SlugStep,
  SLUG_CHECK_DEBOUNCE_MS,
  type WizardFormValues,
} from "../../../../src/pages/onboarding/steps";
import type { SlugCheckStatus } from "../../../../src/api/onboarding";

const EMPTY_FORM: WizardFormValues = {
  name: "",
  slug: "",
  headline: "",
  topicStrip: "",
  subtagline: "",
  description: "",
  rankingPrompt: "",
  shortlistPrompt: "",
  pipelineTime: "06:00",
  emailTime: "07:30",
  timezone: "UTC",
};

function Harness({
  checkSlugFn,
  currentSlug = "",
  onContinue = () => undefined,
}: {
  checkSlugFn: (slug: string) => Promise<SlugCheckStatus>;
  currentSlug?: string;
  onContinue?: () => void;
}): ReactElement {
  const form = useForm<WizardFormValues>({ defaultValues: EMPTY_FORM });
  return (
    <SlugStep
      form={form}
      busy={false}
      currentSlug={currentSlug}
      onBack={() => undefined}
      onContinue={onContinue}
      checkSlugFn={checkSlugFn}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function typeSlug(value: string): void {
  fireEvent.change(screen.getByLabelText("Subdomain"), {
    target: { value },
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SLUG_CHECK_DEBOUNCE_MS);
  });
}

describe("SlugStep", () => {
  it("debounces 300ms and renders the available status inline (REQ-033)", async () => {
    const check = vi.fn(() => Promise.resolve("available" as const));
    render(<Harness checkSlugFn={check} />);

    typeSlug("theinference");
    expect(screen.getByTestId("slug-status").dataset.status).toBe("checking");
    expect(check).not.toHaveBeenCalled();

    await settle();
    expect(check).toHaveBeenCalledExactlyOnceWith("theinference");
    const status = screen.getByTestId("slug-status");
    expect(status.dataset.status).toBe("available");
    expect(status.textContent).toContain("theinference.ourdomain.com is available");
  });

  it("collapses rapid keystrokes into one check for the final value", async () => {
    const check = vi.fn(() => Promise.resolve("available" as const));
    render(<Harness checkSlugFn={check} />);

    typeSlug("t");
    typeSlug("th");
    typeSlug("the");
    await settle();

    expect(check).toHaveBeenCalledExactlyOnceWith("the");
  });

  it("renders taken and reserved as blocking states and disables Continue", async () => {
    const onContinue = vi.fn();
    const check = vi.fn((slug: string) =>
      Promise.resolve((slug === "admin" ? "reserved" : "taken") as SlugCheckStatus),
    );
    render(<Harness checkSlugFn={check} onContinue={onContinue} />);

    typeSlug("snagged");
    await settle();
    expect(screen.getByTestId("slug-status").dataset.status).toBe("taken");

    typeSlug("admin");
    await settle();
    const status = screen.getByTestId("slug-status");
    expect(status.dataset.status).toBe("reserved");
    expect(status.textContent).toContain("reserved");

    const button = screen.getByRole("button", { name: "Continue →" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("treats the tenant's own current slug as available without a network call", async () => {
    const check = vi.fn(() => Promise.resolve("taken" as const));
    render(<Harness checkSlugFn={check} currentSlug="mine" />);

    typeSlug("mine");
    await settle();

    expect(check).not.toHaveBeenCalled();
    expect(screen.getByTestId("slug-status").dataset.status).toBe("available");
  });
});
