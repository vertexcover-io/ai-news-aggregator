import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { useForm } from "react-hook-form";
import {
  ScheduleStep,
  type WizardFormValues,
} from "../../../../src/pages/onboarding/steps";
import type { OnboardingStepId } from "../../../../src/api/onboarding";

afterEach(cleanup);

function Harness({
  missing = [],
  onGoToStep = () => undefined,
  onActivate = () => undefined,
}: {
  missing?: OnboardingStepId[];
  onGoToStep?: (step: OnboardingStepId) => void;
  onActivate?: () => void;
}): ReactElement {
  const form = useForm<WizardFormValues>({
    defaultValues: {
      name: "The Inference",
      slug: "theinference",
      headline: "h",
      topicStrip: "t",
      subtagline: "",
      description: "",
      rankingPrompt: "r",
      shortlistPrompt: "s",
      pipelineTime: "06:00",
      emailTime: "07:30",
      timezone: "UTC",
    },
  });
  return (
    <ScheduleStep
      form={form}
      slug="theinference"
      activating={false}
      missing={missing}
      onBack={() => undefined}
      onActivate={onActivate}
      onGoToStep={onGoToStep}
    />
  );
}

describe("ScheduleStep", () => {
  it("renders the 422 missing list as actionable step links (REQ-038)", () => {
    const onGoToStep = vi.fn();
    render(<Harness missing={["slug", "sources"]} onGoToStep={onGoToStep} />);

    const panel = screen.getByTestId("activate-missing");
    expect(panel.textContent).toContain("Finish these required steps first");

    fireEvent.click(screen.getByRole("button", { name: "Subdomain →" }));
    expect(onGoToStep).toHaveBeenCalledWith("slug");
    fireEvent.click(screen.getByRole("button", { name: "Sources →" }));
    expect(onGoToStep).toHaveBeenCalledWith("sources");
  });

  it("shows the go-live note instead when nothing is missing, and fires activate", () => {
    const onActivate = vi.fn();
    render(<Harness onActivate={onActivate} />);

    expect(screen.queryByTestId("activate-missing")).toBeNull();
    expect(screen.getByText(/theinference\.ourdomain\.com/).textContent).toContain(
      "theinference.ourdomain.com",
    );

    fireEvent.click(screen.getByRole("button", { name: "Activate newsletter ✦" }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
