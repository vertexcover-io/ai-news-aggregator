import { type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface StepShellProps {
  stepNumber: number;
  title: string;
  blurb: string;
  children: ReactNode;
  onBack?: () => void;
  onContinue?: () => void;
  onSkip?: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
}

export function StepShell({
  stepNumber,
  title,
  blurb,
  children,
  onBack,
  onContinue,
  onSkip,
  continueLabel = "Continue →",
  continueDisabled = false,
}: StepShellProps): ReactElement {
  return (
    <div className="max-w-[460px]">
      <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-[#8c3a1e]">
        Step {String(stepNumber).padStart(2, "0")}
      </p>
      <h2 className="mt-1.5 mb-2 font-serif text-[30px] font-medium tracking-[-0.014em] text-[#14110d]">
        {title}
      </h2>
      <p className="mb-6 text-sm leading-relaxed text-[#6b6557]">{blurb}</p>
      {children}
      <div className="mt-8 flex max-w-[460px] items-center justify-between border-t border-[#e7e2d6] pt-5">
        {onBack ? (
          <Button type="button" variant="outline" onClick={onBack}>
            ← Back
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {onSkip ? (
            <Button type="button" variant="ghost" onClick={onSkip}>
              Skip
            </Button>
          ) : null}
          {onContinue ? (
            <Button
              type="button"
              onClick={onContinue}
              disabled={continueDisabled}
              className="bg-[#8c3a1e] text-white hover:bg-[#7a3219]"
            >
              {continueLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
