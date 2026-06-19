import type { ReactElement } from "react";
import type { StepProps } from "./wizardSteps";
import { Field, INPUT_CLASS, StepHeading } from "./fields";

export function NameStep({ data, update }: StepProps): ReactElement {
  return (
    <div>
      <StepHeading
        step={1}
        title="Name your newsletter"
        blurb="This is the publication name readers see in the masthead and in their inbox."
      />
      <Field label="Newsletter name" htmlFor="wizard-name">
        <input
          id="wizard-name"
          className={INPUT_CLASS}
          value={data.name ?? ""}
          placeholder="The Inference"
          onChange={(e) => {
            update({ name: e.target.value });
          }}
        />
      </Field>
    </div>
  );
}
