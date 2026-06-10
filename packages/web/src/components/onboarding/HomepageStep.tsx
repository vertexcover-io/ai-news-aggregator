import { type ReactElement } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepShell } from "./StepShell";
import type { WizardData } from "./types";

interface HomepageStepProps {
  onBack: () => void;
  onContinue: () => void;
}

export function HomepageStep({ onBack, onContinue }: HomepageStepProps): ReactElement {
  const { register, control } = useFormContext<WizardData>();
  const headline = useWatch({ control, name: "headline" });
  return (
    <StepShell
      stepNumber={4}
      title="Your homepage text"
      blurb="These fill the hero on your public homepage. The layout is fixed — you're just filling the slots. Wrap a phrase in *asterisks* to accent it in rust."
      onBack={onBack}
      onContinue={onContinue}
      continueDisabled={!headline.trim()}
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="ob-headline">Headline</Label>
          <textarea
            id="ob-headline"
            {...register("headline")}
            className="min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ob-strip">Topic strip</Label>
          <Input id="ob-strip" {...register("topicStrip")} />
          <p className="text-xs text-[#9b9384]">
            Shown under the headline. Separate topics with &ldquo;·&rdquo;.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ob-subtagline">
            Subtagline <span className="text-[#9b9384]">(optional)</span>
          </Label>
          <Input id="ob-subtagline" {...register("subtagline")} />
        </div>
      </div>
    </StepShell>
  );
}
