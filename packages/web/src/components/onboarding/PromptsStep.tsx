import { type ReactElement } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { generatePrompts } from "@/api/onboarding";
import { StepShell } from "./StepShell";
import type { WizardData } from "./types";

interface PromptsStepProps {
  onBack: () => void;
  onContinue: () => void;
}

const promptTextarea =
  "min-h-[110px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs leading-relaxed shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

export function PromptsStep({ onBack, onContinue }: PromptsStepProps): ReactElement {
  const { register, control, setValue } = useFormContext<WizardData>();
  const blurb = useWatch({ control, name: "blurb" });
  const ranking = useWatch({ control, name: "rankingPrompt" });
  const shortlist = useWatch({ control, name: "shortlistPrompt" });
  const generated = Boolean(ranking.trim() && shortlist.trim());

  const mutation = useMutation({
    mutationFn: () => generatePrompts(blurb),
    onSuccess: (res) => {
      setValue("rankingPrompt", res.rankingPrompt, { shouldDirty: true });
      setValue("shortlistPrompt", res.shortlistPrompt, { shouldDirty: true });
    },
  });

  return (
    <StepShell
      stepNumber={5}
      title="Tune what gets picked"
      blurb="Describe your newsletter in a sentence or two. We'll generate tailored ranking & shortlist prompts from it — you can edit them."
      onBack={onBack}
      onContinue={onContinue}
      continueDisabled={!generated}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="ob-blurb">What&apos;s your newsletter about?</Label>
        <textarea
          id="ob-blurb"
          {...register("blurb")}
          placeholder="e.g. Practical LLM inference — serving, quantization, latency, cost. For ML engineers shipping to prod. Skip funding news and benchmarks."
          className="min-h-[88px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        />
      </div>
      <div className="mt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!blurb.trim() || mutation.isPending}
          onClick={() => { mutation.mutate(); }}
        >
          {mutation.isPending ? "Generating…" : "✦ Generate prompts"}
        </Button>
      </div>
      {mutation.isError ? (
        <p role="alert" className="mt-2 text-sm text-[#b3261e]">
          Prompt generation failed. Try again.
        </p>
      ) : null}
      {generated ? (
        <div className="mt-5 grid gap-4">
          <div className="grid gap-1.5">
            <Label>
              Ranking prompt <span className="text-[#9b9384]">(editable)</span>
            </Label>
            <textarea
              {...register("rankingPrompt")}
              aria-label="Ranking prompt"
              className={promptTextarea}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>
              Shortlist prompt{" "}
              <span className="text-[#9b9384]">(editable)</span>
            </Label>
            <textarea
              {...register("shortlistPrompt")}
              aria-label="Shortlist prompt"
              className={promptTextarea}
            />
          </div>
        </div>
      ) : null}
    </StepShell>
  );
}
