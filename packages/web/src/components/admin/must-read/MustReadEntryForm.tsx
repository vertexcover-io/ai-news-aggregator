import { useEffect, type ReactElement } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const schema = z.object({
  title: z.string().trim().min(1, "Title is required").max(500),
  author: z.string().trim().max(200).nullable(),
  year: z
    .number()
    .int()
    .min(1900)
    .max(2100)
    .nullable(),
  annotation: z.string().trim().min(1, "Annotation is required").max(5000),
});

export type MustReadFormValues = z.infer<typeof schema>;

export interface MustReadEntryFormProps {
  defaultValues: MustReadFormValues;
  onSubmit: (values: MustReadFormValues) => void;
  saving: boolean;
  disabled?: boolean;
  submitLabel?: string;
  banner?: ReactElement | null;
  /**
   * When this prop changes (new object identity), the form re-syncs to the
   * supplied values. Used by the create flow to push prefilled values from
   * preview into the form after the URL is pasted.
   */
  resyncKey?: string;
}

export function MustReadEntryForm({
  defaultValues,
  onSubmit,
  saving,
  disabled = false,
  submitLabel = "Save",
  banner = null,
  resyncKey,
}: MustReadEntryFormProps): ReactElement {
  const form = useForm<MustReadFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  useEffect(() => {
    form.reset(defaultValues);

  }, [resyncKey]);

  const yearReg = form.register("year", {
    setValueAs: (v: unknown) => {
      if (v === null || v === undefined) return null;
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "string") {
        if (v === "") return null;
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    },
  });

  const authorReg = form.register("author", {
    setValueAs: (v: unknown) => {
      if (v === null || v === undefined) return null;
      if (typeof v !== "string") return null;
      const trimmed = v.trim();
      return trimmed === "" ? null : trimmed;
    },
  });

  const handle = form.handleSubmit((values) => {
    onSubmit(values);
  });

  const submitDisabled = saving || disabled;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void handle(e);
      }}
    >
      {banner}

      <div className="space-y-1">
        <label htmlFor="must-read-title" className="text-sm font-medium">
          Title
        </label>
        <Input
          id="must-read-title"
          type="text"
          {...form.register("title")}
          disabled={disabled}
        />
        {form.formState.errors.title ? (
          <p className="text-xs text-red-600">
            {form.formState.errors.title.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="must-read-author" className="text-sm font-medium">
          Author
        </label>
        <Input
          id="must-read-author"
          type="text"
          {...authorReg}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="must-read-year" className="text-sm font-medium">
          Year
        </label>
        <Input
          id="must-read-year"
          type="number"
          inputMode="numeric"
          {...yearReg}
          disabled={disabled}
        />
        {form.formState.errors.year ? (
          <p className="text-xs text-red-600">
            {form.formState.errors.year.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="must-read-annotation" className="text-sm font-medium">
          Annotation
        </label>
        <textarea
          id="must-read-annotation"
          rows={5}
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50"
          {...form.register("annotation")}
          disabled={disabled}
        />
        {form.formState.errors.annotation ? (
          <p className="text-xs text-red-600">
            {form.formState.errors.annotation.message}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitDisabled}>
          {saving ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
