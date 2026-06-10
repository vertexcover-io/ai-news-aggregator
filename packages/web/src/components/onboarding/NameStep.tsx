import { type ReactElement } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepShell } from "./StepShell";
import type { WizardData } from "./types";

interface NameStepProps {
  onContinue: () => void;
}

export function NameStep({ onContinue }: NameStepProps): ReactElement {
  const { register, control } = useFormContext<WizardData>();
  const name = useWatch({ control, name: "name" });
  return (
    <StepShell
      stepNumber={1}
      title="Name your newsletter"
      blurb="This is the publication name readers see in the masthead and in their inbox."
      onContinue={onContinue}
      continueDisabled={!name.trim()}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="ob-name">Newsletter name</Label>
        <Input id="ob-name" {...register("name")} autoFocus />
      </div>
    </StepShell>
  );
}
