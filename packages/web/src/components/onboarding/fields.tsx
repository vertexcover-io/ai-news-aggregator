/**
 * Wizard-local form primitives, themed to the public site palette
 * (cream / ink / rust) per mocks/onboarding.html.
 */
import type { ReactElement, ReactNode } from "react";

export const INPUT_CLASS =
  "w-full rounded-lg border border-[#d8d2c2] bg-white px-3.5 py-2.5 text-[14px] text-[#14110d] outline-none transition-colors focus:border-[#8c3a1e] focus:ring-2 focus:ring-[#8c3a1e]/15 placeholder:text-[#a39d8d]";

export const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[88px] resize-y leading-relaxed`;

export const LABEL_CLASS =
  "mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#3f3a30]";

export const HELP_CLASS = "mt-1.5 text-[12.5px] leading-relaxed text-[#6b6557]";

export const BTN_RUST =
  "inline-flex items-center gap-1.5 rounded-lg bg-[#8c3a1e] px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#73301a] disabled:cursor-not-allowed disabled:opacity-50";

export const BTN_OUTLINE =
  "inline-flex items-center gap-1.5 rounded-lg border border-[#d8d2c2] bg-transparent px-4 py-2.5 text-[13.5px] font-medium text-[#3f3a30] transition-colors hover:border-[#8c3a1e] hover:text-[#8c3a1e] disabled:cursor-not-allowed disabled:opacity-50";

export const BTN_GHOST =
  "inline-flex items-center rounded-lg px-3.5 py-2.5 text-[13.5px] font-medium text-[#6b6557] transition-colors hover:text-[#14110d]";

export function Field({
  label,
  htmlFor,
  children,
  help,
}: {
  label: ReactNode;
  htmlFor: string;
  children: ReactNode;
  help?: ReactNode;
}): ReactElement {
  return (
    <div className="mb-5">
      <label className={LABEL_CLASS} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help !== undefined ? <p className={HELP_CLASS}>{help}</p> : null}
    </div>
  );
}

export function StepHeading({
  step,
  title,
  blurb,
}: {
  step: number;
  title: string;
  blurb: ReactNode;
}): ReactElement {
  return (
    <>
      <p className="m-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[#8c3a1e]">
        Step {String(step).padStart(2, "0")}
      </p>
      <h2 className="mb-2 mt-1.5 font-serif text-[30px] font-medium leading-tight tracking-[-0.014em] text-[#14110d]">
        {title}
      </h2>
      <p className="mb-6 max-w-[46ch] text-[14px] leading-relaxed text-[#6b6557]">
        {blurb}
      </p>
    </>
  );
}
