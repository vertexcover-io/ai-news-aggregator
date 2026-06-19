/**
 * Schedule + activation step (REQ-025/035/038). Times default on first
 * visit; the Activate control stays disabled while required steps are
 * missing and the remaining steps are listed (the server re-asserts the
 * same gate on POST /activate).
 */
import type { ReactElement } from "react";
import type { OnboardingRequiredStep } from "@newsletter/shared/types/tenant";
import {
  MISSING_STEP_LABELS,
  type StepProps,
} from "./wizardSteps";
import {
  BTN_RUST,
  Field,
  INPUT_CLASS,
  StepHeading,
} from "./fields";

const KNOWN_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
];

export interface ScheduleStepProps extends StepProps {
  missing: OnboardingRequiredStep[];
  activating: boolean;
  activationError: string | null;
  onActivate: () => void;
}

export function ScheduleStep({
  data,
  update,
  missing,
  activating,
  activationError,
  onActivate,
}: ScheduleStepProps): ReactElement {
  // Schedule defaults are seeded by the wizard's initial draft state — the
  // select just needs to render whatever value is set, even one outside the
  // curated list (e.g. the browser's own timezone).
  const timezone = data.timezone ?? "UTC";
  const timezones = KNOWN_TIMEZONES.includes(timezone)
    ? KNOWN_TIMEZONES
    : [timezone, ...KNOWN_TIMEZONES];

  const ready = missing.length === 0;

  return (
    <div>
      <StepHeading
        step={8}
        title="Set your schedule"
        blurb="When the pipeline runs and when the digest sends. We jitter start times slightly to spread load."
      />
      <div className="grid grid-cols-2 gap-4">
        <Field label="Pipeline run" htmlFor="wizard-pipeline-time">
          <input
            id="wizard-pipeline-time"
            type="time"
            className={INPUT_CLASS}
            value={data.pipelineTime ?? "06:00"}
            onChange={(e) => {
              update({ pipelineTime: e.target.value });
            }}
          />
        </Field>
        <Field label="Email send" htmlFor="wizard-email-time">
          <input
            id="wizard-email-time"
            type="time"
            className={INPUT_CLASS}
            value={data.emailTime ?? "07:30"}
            onChange={(e) => {
              update({ emailTime: e.target.value });
            }}
          />
        </Field>
      </div>
      <Field label="Timezone" htmlFor="wizard-timezone">
        <select
          id="wizard-timezone"
          className={INPUT_CLASS}
          value={timezone}
          onChange={(e) => {
            update({ timezone: e.target.value });
          }}
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </Field>

      {ready ? (
        <p className="mt-1 rounded-lg border border-[#e7e2d6] bg-[#f3efe6] px-4 py-3 text-[13.5px] leading-relaxed text-[#3f3a30]">
          You’re all set on the required steps. Activating makes your site
          live and starts your daily runs.
        </p>
      ) : (
        <div className="mt-1 rounded-lg border border-[#e7c9b8] bg-[#faf1ea] px-4 py-3">
          <p className="m-0 text-[13.5px] font-medium text-[#7a2f15]">
            Finish these steps before activating:
          </p>
          <ul
            aria-label="Remaining steps"
            className="mb-0 mt-1.5 list-disc pl-5 text-[13px] text-[#7a2f15]"
          >
            {missing.map((step) => (
              <li key={step}>{MISSING_STEP_LABELS[step]}</li>
            ))}
          </ul>
        </div>
      )}
      {activationError !== null ? (
        <p role="alert" className="mt-3 text-[13px] text-[#a33b2a]">
          {activationError}
        </p>
      ) : null}
      <div className="mt-6">
        <button
          type="button"
          className={`${BTN_RUST} px-6`}
          disabled={!ready || activating}
          onClick={onActivate}
        >
          {activating ? "Activating…" : "Activate newsletter ✦"}
        </button>
      </div>
    </div>
  );
}
