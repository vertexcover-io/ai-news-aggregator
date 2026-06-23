import type { ReactElement } from "react";
import type { StepProps } from "./wizardSteps";
import { Field, INPUT_CLASS, StepHeading, TEXTAREA_CLASS } from "./fields";

export function HomepageTextStep({ data, update }: StepProps): ReactElement {
  return (
    <div>
      <StepHeading
        step={4}
        title="Your homepage text"
        blurb="These fill the hero on your public homepage. The layout is fixed — you’re just filling the slots."
      />
      <Field label="Headline" htmlFor="wizard-headline">
        <textarea
          id="wizard-headline"
          className={TEXTAREA_CLASS}
          value={data.headline ?? ""}
          placeholder="The daily read for people building with inference."
          onChange={(e) => {
            update({ headline: e.target.value });
          }}
        />
      </Field>
      <Field
        label="Topic strip"
        htmlFor="wizard-topic-strip"
        help="Shown under the headline. Separate topics with “·”."
      >
        <input
          id="wizard-topic-strip"
          className={INPUT_CLASS}
          value={data.topicStrip ?? ""}
          placeholder="Serving · Quantization · Latency · Cost"
          onChange={(e) => {
            update({ topicStrip: e.target.value });
          }}
        />
      </Field>
      <Field
        label={
          <>
            Subtagline <span className="text-[#a39d8d]">(optional)</span>
          </>
        }
        htmlFor="wizard-subtagline"
      >
        <input
          id="wizard-subtagline"
          className={INPUT_CLASS}
          value={data.subtagline ?? ""}
          placeholder="No funding rounds. No leaderboards. Just the runtime."
          onChange={(e) => {
            update({ subtagline: e.target.value });
          }}
        />
      </Field>
    </div>
  );
}
