import type { ReactElement } from "react";
import { useFieldArray, type UseFormReturn } from "react-hook-form";
import type { RunFormValues } from "./index";

interface WebSectionProps {
  form: UseFormReturn<RunFormValues>;
  enabled: boolean;
}

export function WebSection({ form, enabled }: WebSectionProps): ReactElement {
  const { register, control } = form;
  const { fields, append, remove } = useFieldArray({
    control,
    name: "web.sources",
  });

  return (
    <fieldset className="border border-gray-200 rounded p-4">
      <legend className="px-2 text-sm font-semibold">
        <label className="flex items-center gap-2">
          <input type="checkbox" {...register("webEnabled")} />
          Web sources
        </label>
      </legend>
      <div className={`space-y-3 mt-2 ${enabled ? "" : "opacity-50"}`}>
        <div className="space-y-2">
          {fields.map((field, index) => {
            const position = String(index + 1);
            return (
              <div
                key={field.id}
                className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2 items-start"
              >
                <input
                  type="text"
                  disabled={!enabled}
                  placeholder="Anthropic Research"
                  aria-label={`Source ${position} name`}
                  className="block w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  {...register(
                    `web.sources.${String(index)}.name` as `web.sources.${number}.name`,
                  )}
                />
                <input
                  type="url"
                  disabled={!enabled}
                  placeholder="https://www.anthropic.com/research"
                  aria-label={`Source ${position} listing URL`}
                  className="block w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  {...register(
                    `web.sources.${String(index)}.listingUrl` as `web.sources.${number}.listingUrl`,
                  )}
                />
                <button
                  type="button"
                  disabled={!enabled || fields.length === 1}
                  onClick={() => {
                    remove(index);
                  }}
                  aria-label={`Remove source ${position}`}
                  className="px-2 py-2 text-sm text-gray-600 hover:text-red-600 disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button
            type="button"
            disabled={!enabled}
            onClick={() => {
              append({ name: "", listingUrl: "" });
            }}
            className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
          >
            + Add source
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            Max items
            <input
              type="number"
              disabled={!enabled}
              className="mt-1 block w-full border border-gray-300 rounded px-3 py-2"
              {...register("web.maxItems", {
                valueAsNumber: true,
                min: 1,
                max: 100,
              })}
            />
          </label>
          <label className="block text-sm">
            Since (days)
            <input
              type="number"
              disabled={!enabled}
              className="mt-1 block w-full border border-gray-300 rounded px-3 py-2"
              {...register("web.sinceDays", {
                valueAsNumber: true,
                min: 1,
              })}
            />
          </label>
        </div>
      </div>
    </fieldset>
  );
}
