import { useState, type ReactElement } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import type { RunSubmitPayload } from "@newsletter/shared";
import { submitRun } from "../../api/runs";
import { HnSection } from "./HnSection";
import { RedditSection } from "./RedditSection";

export interface RunFormValues {
  topN: number;
  hnEnabled: boolean;
  hn: {
    keywords: string;
    pointsThreshold: number;
    sinceDays: number;
  };
  redditEnabled: boolean;
  reddit: {
    subreddits: string;
    sort: "hot" | "new" | "top";
    limit: number;
    sinceDays: number;
  };
}

const DEFAULT_VALUES: RunFormValues = {
  topN: 10,
  hnEnabled: true,
  hn: {
    keywords: "",
    pointsThreshold: 20,
    sinceDays: 3,
  },
  redditEnabled: false,
  reddit: {
    subreddits: "",
    sort: "hot",
    limit: 25,
    sinceDays: 3,
  },
};

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function buildPayload(values: RunFormValues): RunSubmitPayload {
  const payload: RunSubmitPayload = { topN: values.topN };
  if (values.hnEnabled) {
    const keywords = splitCsv(values.hn.keywords);
    payload.hn = {
      sinceDays: values.hn.sinceDays,
      pointsThreshold: values.hn.pointsThreshold,
      ...(keywords.length > 0 ? { keywords } : {}),
    };
  }
  if (values.redditEnabled) {
    payload.reddit = {
      subreddits: splitCsv(values.reddit.subreddits),
      sort: values.reddit.sort,
      limit: values.reddit.limit,
      sinceDays: values.reddit.sinceDays,
    };
  }
  return payload;
}

export interface RunFormProps {
  onSubmitted: (runId: string) => void;
}

export function RunForm({ onSubmitted }: RunFormProps): ReactElement {
  const form = useForm<RunFormValues>({ defaultValues: DEFAULT_VALUES });
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = form;
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onValid: SubmitHandler<RunFormValues> = async (values) => {
    setSourceError(null);
    setSubmitError(null);
    if (!values.hnEnabled && !values.redditEnabled) {
      setSourceError("Enable at least one source (HN or Reddit).");
      return;
    }
    try {
      const { runId } = await submitRun(buildPayload(values));
      onSubmitted(runId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit");
    }
  };

  const hnEnabled = watch("hnEnabled");
  const redditEnabled = watch("redditEnabled");

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onValid)(e);
      }}
      className="space-y-6"
      noValidate
    >
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Top N
        </label>
        <input
          type="number"
          className="mt-1 block w-32 border border-gray-300 rounded px-3 py-2"
          {...register("topN", {
            valueAsNumber: true,
            required: true,
            min: 1,
            max: 50,
          })}
        />
        {errors.topN && (
          <p className="text-sm text-red-600 mt-1">topN must be 1-50</p>
        )}
      </div>

      <HnSection form={form} enabled={hnEnabled} />
      <RedditSection form={form} enabled={redditEnabled} />

      {sourceError && (
        <p role="alert" className="text-sm text-red-600">
          {sourceError}
        </p>
      )}
      {submitError && (
        <p role="alert" className="text-sm text-red-600">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? "Submitting..." : "Run"}
      </button>
    </form>
  );
}
