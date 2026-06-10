import { type ReactElement } from "react";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { StepShell } from "./StepShell";
import type { WizardData } from "./types";

interface ChannelsStepProps {
  onBack: () => void;
  onContinue: () => void;
}

const channels = [
  { name: "LinkedIn", desc: "Post the digest to your page", bg: "#0a66c2", glyph: "in" },
  { name: "Twitter / X", desc: "Authorize posting via OAuth", bg: "#111", glyph: "𝕏" },
] as const;

export function ChannelsStep({ onBack, onContinue }: ChannelsStepProps): ReactElement {
  const { register } = useFormContext<WizardData>();
  return (
    <StepShell
      stepNumber={6}
      title="Connect channels"
      blurb="Optional — connect where you'll publish. We never ask for app keys or secrets; you authorize via OAuth."
      onBack={onBack}
      onContinue={onContinue}
      onSkip={onContinue}
    >
      {channels.map((ch) => (
        <div
          key={ch.name}
          className="mb-3 flex items-center justify-between rounded-xl border border-[#e7e2d6] p-4"
        >
          <div className="flex items-center gap-3">
            <span
              className="grid size-[34px] place-items-center rounded-lg font-mono text-[13px] font-semibold text-white"
              style={{ background: ch.bg }}
            >
              {ch.glyph}
            </span>
            <div>
              <div className="text-sm font-semibold">{ch.name}</div>
              <div className="text-xs text-[#9b9384]">{ch.desc}</div>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" disabled>
            Connect
          </Button>
        </div>
      ))}
      <div className="mt-4 grid gap-1.5">
        <Label htmlFor="ob-email">Sending email (broadcast)</Label>
        <Input
          id="ob-email"
          type="email"
          placeholder="hello@yournewsletter.com"
          {...register("notificationEmail")}
        />
        <p className="text-xs text-[#9b9384]">
          You&apos;ll verify this domain after setup. Until then, confirmations
          send from our shared address and the broadcast stays paused.
        </p>
      </div>
    </StepShell>
  );
}
