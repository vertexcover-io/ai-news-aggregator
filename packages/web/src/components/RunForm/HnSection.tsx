import type { ReactElement } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { RunFormValues } from "./index";

interface HnSectionProps {
  form: UseFormReturn<RunFormValues>;
  enabled: boolean;
}

export function HnSection({ form, enabled }: HnSectionProps): ReactElement {
  const { register } = form;
  return (
    <fieldset className="border border-gray-200 rounded p-4">
      <legend className="px-2 text-sm font-semibold">
        <label className="flex items-center gap-2">
          <input type="checkbox" {...register("hnEnabled")} />
          Hacker News
        </label>
      </legend>
      <div
        className={`grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2 ${enabled ? "" : "opacity-50"}`}
      >
        <label className="block text-sm sm:col-span-3">
          Keywords (comma-separated)
          <input
            type="text"
            disabled={!enabled}
            className="mt-1 block w-full border border-gray-300 rounded px-3 py-2"
            {...register("hn.keywords")}
          />
        </label>
        <label className="block text-sm">
          Points threshold
          <input
            type="number"
            disabled={!enabled}
            className="mt-1 block w-full border border-gray-300 rounded px-3 py-2"
            {...register("hn.pointsThreshold", { valueAsNumber: true, min: 0 })}
          />
        </label>
        <label className="block text-sm">
          Since (days)
          <input
            type="number"
            disabled={!enabled}
            className="mt-1 block w-full border border-gray-300 rounded px-3 py-2"
            {...register("hn.sinceDays", { valueAsNumber: true, min: 1 })}
          />
        </label>
        <label className="block text-sm">
          Max items per feed
          <input
            type="number"
            disabled={!enabled}
            className="mt-1 block w-full border border-gray-300 rounded px-3 py-2"
            {...register("hn.count", { valueAsNumber: true, min: 1, max: 1000 })}
          />
        </label>
        <div className="block text-sm sm:col-span-2">
          Feeds
          <div className="mt-1 flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={!enabled}
                {...register("hn.feedNewest")}
              />
              newest
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={!enabled}
                {...register("hn.feedBest")}
              />
              best
            </label>
          </div>
        </div>
        <label className="block text-sm">
          Comments per item
          <input
            type="number"
            disabled={!enabled}
            className="mt-1 block w-full border border-gray-300 rounded px-3 py-2"
            {...register("hn.commentsPerItem", {
              valueAsNumber: true,
              min: 0,
              max: 100,
            })}
          />
        </label>
      </div>
    </fieldset>
  );
}
