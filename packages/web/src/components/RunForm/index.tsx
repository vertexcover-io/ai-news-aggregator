import { useState, type ReactElement } from "react";
import { useForm, useWatch, type SubmitHandler } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import type { RunSubmitPayload } from "@newsletter/shared";
import { submitRun } from "../../api/runs";
import { fetchProfiles } from "../../api/profiles";
import { HnSection } from "./HnSection";
import { RedditSection } from "./RedditSection";
import { WebSection } from "./WebSection";

export interface RunFormValues {
  profileName: string;
  topN: number;
  hnEnabled: boolean;
  hn: {
    keywords: string;
    pointsThreshold: number;
    sinceDays: number;
    feedNewest: boolean;
    feedBest: boolean;
    count: number;
    commentsPerItem: number;
  };
  redditEnabled: boolean;
  reddit: {
    subreddits: string;
    sort: "hot" | "new" | "top";
    limit: number;
    sinceDays: number;
  };
  webEnabled: boolean;
  web: {
    sources: { name: string; listingUrl: string }[];
    maxItems: number;
    sinceDays: number;
  };
}

const DEFAULT_VALUES: RunFormValues = {
  profileName: "",
  topN: 10,
  hnEnabled: true,
  hn: {
    keywords: "",
    pointsThreshold: 20,
    sinceDays: 3,
    feedNewest: true,
    feedBest: true,
    count: 100,
    commentsPerItem: 20,
  },
  redditEnabled: false,
  reddit: {
    subreddits: "",
    sort: "hot",
    limit: 25,
    sinceDays: 3,
  },
  webEnabled: false,
  web: {
    sources: [{ name: "", listingUrl: "" }],
    maxItems: 10,
    sinceDays: 7,
  },
};

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function buildPayload(values: RunFormValues): RunSubmitPayload {
  const payload: RunSubmitPayload = {
    topN: values.topN,
    profileName: values.profileName === "" ? null : values.profileName,
  };
  if (values.hnEnabled) {
    const keywords = splitCsv(values.hn.keywords);
    const feeds: ("newest" | "best")[] = [];
    if (values.hn.feedNewest) feeds.push("newest");
    if (values.hn.feedBest) feeds.push("best");
    payload.hn = {
      sinceDays: values.hn.sinceDays,
      pointsThreshold: values.hn.pointsThreshold,
      count: values.hn.count,
      commentsPerItem: values.hn.commentsPerItem,
      ...(keywords.length > 0 ? { keywords } : {}),
      ...(feeds.length > 0 ? { feeds } : {}),
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
  if (values.webEnabled) {
    const sources = values.web.sources
      .map((s) => ({ name: s.name.trim(), listingUrl: s.listingUrl.trim() }))
      .filter((s) => s.name.length > 0 && s.listingUrl.length > 0);
    if (sources.length > 0) {
      payload.web = {
        sources,
        maxItems: values.web.maxItems,
        sinceDays: values.web.sinceDays,
      };
    }
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
    control,
    formState: { errors, isSubmitting },
  } = form;
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: profiles = [], isLoading: profilesLoading } = useQuery<
    string[]
  >({
    queryKey: ["profiles"],
    queryFn: fetchProfiles,
  });

  const onValid: SubmitHandler<RunFormValues> = async (values) => {
    setSourceError(null);
    setSubmitError(null);
    if (!values.hnEnabled && !values.redditEnabled && !values.webEnabled) {
      setSourceError("Enable at least one source (HN, Reddit, or Web).");
      return;
    }
    if (values.hnEnabled && !values.hn.feedNewest && !values.hn.feedBest) {
      setSourceError("Select at least one HN feed (newest or best).");
      return;
    }
    const payload = buildPayload(values);
    if (values.webEnabled && payload.web === undefined) {
      setSourceError("Add at least one web source with a name and URL.");
      return;
    }
    try {
      const { runId } = await submitRun(payload);
      onSubmitted(runId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit");
    }
  };

  const hnEnabled = useWatch({ control, name: "hnEnabled" });
  const redditEnabled = useWatch({ control, name: "redditEnabled" });
  const webEnabled = useWatch({ control, name: "webEnabled" });

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onValid)(e);
      }}
      className="space-y-6"
      noValidate
    >
      <div>
        <label
          htmlFor="profileName"
          className="block text-sm font-medium text-gray-700"
        >
          Profile
        </label>
        <select
          id="profileName"
          aria-label="Profile"
          disabled={profilesLoading}
          className="mt-1 block w-48 border border-gray-300 rounded px-3 py-2"
          {...register("profileName")}
        >
          <option value="">No profile</option>
          {profiles.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

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
      <WebSection form={form} enabled={webEnabled} />

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
