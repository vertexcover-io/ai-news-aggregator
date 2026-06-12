/**
 * Prompt-tuning step (REQ-036). The blurb goes to POST
 * /api/onboarding/generate-prompts (Anthropic server-side; stubbed in every
 * test) and the two generated prompts land in EDITABLE textareas bound to
 * the wizard data — edits persist like any other field.
 */
import { useMutation } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { generatePrompts } from "../../api/onboarding";
import type { StepProps } from "./wizardSteps";
import {
  BTN_OUTLINE,
  Field,
  StepHeading,
  TEXTAREA_CLASS,
} from "./fields";

export function PromptsStep({ data, update }: StepProps): ReactElement {
  const blurb = data.blurb ?? "";
  const generate = useMutation({
    mutationFn: (text: string) => generatePrompts(text),
    onSuccess: (prompts) => {
      update({
        rankingPrompt: prompts.rankingPrompt,
        shortlistPrompt: prompts.shortlistPrompt,
      });
    },
  });

  const showPrompts =
    (data.rankingPrompt ?? "").length > 0 ||
    (data.shortlistPrompt ?? "").length > 0;

  return (
    <div>
      <StepHeading
        step={5}
        title="Tune what gets picked"
        blurb="Describe your newsletter in a sentence or two. We’ll generate tailored ranking & shortlist prompts from it — you can edit them."
      />
      <Field label="What’s your newsletter about?" htmlFor="wizard-blurb">
        <textarea
          id="wizard-blurb"
          className={TEXTAREA_CLASS}
          value={blurb}
          placeholder="e.g. Practical LLM inference — serving, quantization, latency, cost. For ML engineers shipping to prod."
          onChange={(e) => {
            update({ blurb: e.target.value });
          }}
        />
      </Field>
      <button
        type="button"
        className={BTN_OUTLINE}
        disabled={blurb.trim().length === 0 || generate.isPending}
        onClick={() => {
          generate.mutate(blurb.trim());
        }}
      >
        ✦ {generate.isPending ? "Generating…" : "Generate prompts"}
      </button>
      {generate.isError ? (
        <p role="alert" className="mt-2 text-[13px] text-[#a33b2a]">
          Prompt generation failed — try again or write the prompts yourself.
        </p>
      ) : null}

      {showPrompts ? (
        <div className="mt-6">
          <Field
            label={
              <>
                Ranking prompt <span className="text-[#a39d8d]">(editable)</span>
              </>
            }
            htmlFor="wizard-ranking-prompt"
          >
            <textarea
              id="wizard-ranking-prompt"
              className={`${TEXTAREA_CLASS} min-h-[110px] font-mono text-[12px]`}
              value={data.rankingPrompt ?? ""}
              onChange={(e) => {
                update({ rankingPrompt: e.target.value });
              }}
            />
          </Field>
          <Field
            label={
              <>
                Shortlist prompt{" "}
                <span className="text-[#a39d8d]">(editable)</span>
              </>
            }
            htmlFor="wizard-shortlist-prompt"
          >
            <textarea
              id="wizard-shortlist-prompt"
              className={`${TEXTAREA_CLASS} min-h-[88px] font-mono text-[12px]`}
              value={data.shortlistPrompt ?? ""}
              onChange={(e) => {
                update({ shortlistPrompt: e.target.value });
              }}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}
