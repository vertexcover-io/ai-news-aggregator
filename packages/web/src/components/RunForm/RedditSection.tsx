import type { ReactElement } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { RunFormValues } from "./index";

interface RedditSectionProps {
  form: UseFormReturn<RunFormValues>;
  enabled: boolean;
}

export function RedditSection({
  form,
  enabled,
}: RedditSectionProps): ReactElement {
  const { register } = form;
  return (
    <fieldset className="border border-gray-200 rounded p-4">
      <legend className="px-2 text-sm font-semibold">
        <label className="flex items-center gap-2">
          <input type="checkbox" {...register("redditEnabled")} />
          Reddit
        </label>
      </legend>
      <div
        className={`grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 ${enabled ? "" : "opacity-50"}`}
      >
        <label className="block text-sm sm:col-span-2">
          Subreddits (comma-separated)
          <input
            type="text"
            disabled={!enabled}
            placeholder="MachineLearning, LocalLLaMA"
            className="mt-1 block w-full border border-gray-300 rounded px-3 py-2"
            {...register("reddit.subreddits")}
          />
        </label>
        <label className="block text-sm">
          Sort
          <select
            disabled={!enabled}
            className="mt-1 block w-full border border-gray-300 rounded px-3 py-2"
            {...register("reddit.sort")}
          >
            <option value="hot">hot</option>
            <option value="new">new</option>
            <option value="top">top</option>
          </select>
        </label>
        <label className="block text-sm">
          Limit
          <input
            type="number"
            disabled={!enabled}
            className="mt-1 block w-full border border-gray-300 rounded px-3 py-2"
            {...register("reddit.limit", { valueAsNumber: true, min: 1 })}
          />
        </label>
        <label className="block text-sm">
          Since (days)
          <input
            type="number"
            disabled={!enabled}
            className="mt-1 block w-full border border-gray-300 rounded px-3 py-2"
            {...register("reddit.sinceDays", { valueAsNumber: true, min: 1 })}
          />
        </label>
      </div>
    </fieldset>
  );
}
