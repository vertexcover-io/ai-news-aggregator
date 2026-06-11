/**
 * Sources step (REQ-037/051). "Discover sources" calls the LLM+Tavily
 * endpoint (stubbed in every test) and renders the candidates as
 * click-to-add pills — NOTHING is added until a pill is clicked, which goes
 * through the SAME manual-add path (`POST /api/sources`, P8 repo) as the
 * Settings panel. Manual add + remove round out the controls; ≥1 source is
 * required for activation.
 */
import { useMutation } from "@tanstack/react-query";
import { useState, type ReactElement } from "react";
import type { SourceCandidate } from "@newsletter/shared/types/tenant";
import {
  MANUAL_SOURCE_TYPES,
  type ManualSourceType,
} from "@newsletter/shared/types";
import { discoverSources } from "../../api/onboarding";
import { useTenantSources } from "../../hooks/useTenantSources";
import { inferManualSource } from "./wizardSteps";
import {
  BTN_OUTLINE,
  Field,
  HELP_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  StepHeading,
} from "./fields";

const PILL_SUGGEST =
  "inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#c9c2af] bg-white px-3.5 py-1.5 text-[13px] text-[#3f3a30] transition-colors hover:border-[#8c3a1e] hover:text-[#8c3a1e] disabled:opacity-50";

const PILL_SELECTED =
  "inline-flex items-center gap-2 rounded-full border border-[#d8d2c2] bg-[#f3efe6] px-3.5 py-1.5 text-[13px] text-[#14110d]";

function isManualType(type: string): type is ManualSourceType {
  return (MANUAL_SOURCE_TYPES as readonly string[]).includes(type);
}

export interface SourcesStepProps {
  blurb: string;
}

export function SourcesStep({ blurb }: SourcesStepProps): ReactElement {
  const { query, add, remove } = useTenantSources();
  const [candidates, setCandidates] = useState<SourceCandidate[]>([]);
  const [addedValues, setAddedValues] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [manual, setManual] = useState("");

  const discover = useMutation({
    mutationFn: (text: string) => discoverSources(text),
    onSuccess: (res) => {
      setCandidates(res.candidates.filter((c) => isManualType(c.type)));
    },
  });

  const addCandidate = (candidate: SourceCandidate): void => {
    if (!isManualType(candidate.type)) return;
    add.mutate(
      { type: candidate.type, value: candidate.value },
      {
        onSuccess: () => {
          setAddedValues((prev) => new Set([...prev, candidate.value]));
        },
      },
    );
  };

  const addManual = (): void => {
    if (manual.trim().length === 0) return;
    const inferred = inferManualSource(manual);
    add.mutate(inferred, {
      onSuccess: () => {
        setManual("");
      },
    });
  };

  const selected = query.data ?? [];
  const groups = [...new Set(candidates.map((c) => c.group))];

  return (
    <div>
      <StepHeading
        step={7}
        title="Choose your sources"
        blurb="Suggestions from your description (LLM + web search). Click to add — or add your own. You need at least one."
      />

      <button
        type="button"
        className={BTN_OUTLINE}
        disabled={blurb.trim().length === 0 || discover.isPending}
        onClick={() => {
          discover.mutate(blurb.trim());
        }}
      >
        ✦ {discover.isPending ? "Discovering…" : "Discover sources"}
      </button>
      {blurb.trim().length === 0 ? (
        <p className={HELP_CLASS}>
          Write your newsletter description in the Prompts step to get
          suggestions.
        </p>
      ) : null}
      {discover.isError ? (
        <p role="alert" className="mt-2 text-[13px] text-[#a33b2a]">
          Discovery failed — add sources manually below.
        </p>
      ) : null}

      {groups.map((group) => (
        <div key={group} className="mt-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#6b6557]">
            {group}
          </div>
          <div className="flex flex-wrap gap-2">
            {candidates
              .filter((c) => c.group === group)
              .map((candidate) => {
                const added = addedValues.has(candidate.value);
                return (
                  <button
                    key={`${candidate.type}:${candidate.value}`}
                    type="button"
                    className={PILL_SUGGEST}
                    disabled={added || add.isPending}
                    onClick={() => {
                      addCandidate(candidate);
                    }}
                  >
                    <span aria-hidden="true" className="text-[#8c3a1e]">
                      {added ? "✓" : "+"}
                    </span>
                    {candidate.label}
                  </button>
                );
              })}
          </div>
        </div>
      ))}

      <hr className="my-6 border-0 border-t border-[#e7e2d6]" />

      <div className={LABEL_CLASS}>
        Selected · {selected.length}{" "}
        {selected.length === 1 ? "source" : "sources"}
      </div>
      {selected.length === 0 ? (
        <p className={HELP_CLASS}>
          Nothing selected yet — you need at least one source to activate.
        </p>
      ) : (
        <ul
          aria-label="Selected sources"
          className="m-0 flex list-none flex-wrap gap-2 p-0"
        >
          {selected.map((source) => (
            <li key={source.id} className={PILL_SELECTED}>
              {source.name}
              <button
                type="button"
                aria-label={`Remove ${source.name}`}
                className="text-[#6b6557] transition-colors hover:text-[#a33b2a]"
                onClick={() => {
                  remove.mutate(source.id);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5">
        <Field
          label="Add manually"
          htmlFor="wizard-manual-source"
          help="Paste an RSS feed URL, a subreddit (r/…), or an @handle."
        >
          <div className="flex gap-2">
            <input
              id="wizard-manual-source"
              className={INPUT_CLASS}
              value={manual}
              placeholder="Paste an RSS feed, subreddit, or @handle"
              onChange={(e) => {
                setManual(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManual();
                }
              }}
            />
            <button
              type="button"
              className={BTN_OUTLINE}
              disabled={manual.trim().length === 0 || add.isPending}
              onClick={addManual}
            >
              Add
            </button>
          </div>
        </Field>
      </div>
    </div>
  );
}
