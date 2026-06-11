import type { ReactElement } from "react";
import type { StepProps } from "./wizardSteps";
import { Field, INPUT_CLASS, StepHeading } from "./fields";

/**
 * Optional channels step. LinkedIn / X OAuth connects arrive with the
 * credentials rework (P12/P13) — until then the rows are informative only.
 * The sending email is stored in the wizard data for the P14 domain flow.
 */
export function SocialStep({ data, update }: StepProps): ReactElement {
  return (
    <div>
      <StepHeading
        step={6}
        title="Connect channels"
        blurb="Optional — connect where you’ll publish. You can do all of this later from Settings."
      />
      {[
        {
          name: "LinkedIn",
          hint: "Post the digest to your page",
          badge: "in",
          badgeClass: "bg-[#0a66c2]",
        },
        {
          name: "Twitter / X",
          hint: "Authorize posting via OAuth",
          badge: "𝕏",
          badgeClass: "bg-[#111111]",
        },
      ].map((row) => (
        <div
          key={row.name}
          className="mb-3 flex items-center justify-between rounded-xl border border-[#e7e2d6] px-4 py-3.5"
        >
          <span className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={`grid h-[34px] w-[34px] place-items-center rounded-lg font-mono text-[13px] font-semibold text-white ${row.badgeClass}`}
            >
              {row.badge}
            </span>
            <span>
              <span className="block text-[14px] font-semibold text-[#14110d]">
                {row.name}
              </span>
              <span className="block text-[12.5px] text-[#6b6557]">
                {row.hint}
              </span>
            </span>
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#a39d8d]">
            Available after setup
          </span>
        </div>
      ))}
      <div className="mt-5">
        <Field
          label="Sending email (broadcast)"
          htmlFor="wizard-from-email"
          help="You’ll verify this domain after setup. Until then the broadcast stays paused."
        >
          <input
            id="wizard-from-email"
            type="email"
            className={INPUT_CLASS}
            value={data.fromEmail ?? ""}
            placeholder="hello@theinference.com"
            onChange={(e) => {
              update({ fromEmail: e.target.value });
            }}
          />
        </Field>
      </div>
    </div>
  );
}
