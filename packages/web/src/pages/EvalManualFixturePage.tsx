import { useMemo, useState, type ReactElement } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createManualFixture, EvalApiError } from "../api/eval";

interface FormValues {
  urls: string;
  name: string;
}

interface ParsedLine {
  line: string;
  trimmed: string;
  isBlank: boolean;
  isValid: boolean;
}

function parseLines(input: string): ParsedLine[] {
  return input.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    const isBlank = trimmed.length === 0;
    let isValid = false;
    if (!isBlank) {
      try {
        // new URL throws on invalid inputs.
        // Require absolute http(s)://… so bare strings don't pass.
        const u = new URL(trimmed);
        isValid = u.protocol === "http:" || u.protocol === "https:";
      } catch {
        isValid = false;
      }
    }
    return { line, trimmed, isBlank, isValid };
  });
}

export function EvalManualFixturePage(): ReactElement {
  const navigate = useNavigate();
  const { register, handleSubmit, control } = useForm<FormValues>({
    defaultValues: { urls: "", name: "" },
  });
  const [submitting, setSubmitting] = useState(false);

  const urlsValue = useWatch({ control, name: "urls" });
  const parsed = useMemo(() => parseLines(urlsValue), [urlsValue]);
  const validUrls = useMemo(
    () => parsed.filter((p) => !p.isBlank && p.isValid).map((p) => p.trimmed),
    [parsed],
  );
  const hasInvalidLine = parsed.some((p) => !p.isBlank && !p.isValid);
  const canSubmit = !submitting && validUrls.length >= 1 && !hasInvalidLine;

  const onSubmit = handleSubmit(async (values) => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await createManualFixture(validUrls, values.name);
      toast.success(`Fixture created with ${String(result.itemCount)} item(s)`);
      void navigate(`/admin/eval/grade/${result.fixtureId}`);
    } catch (err) {
      if (err instanceof EvalApiError) {
        toast.error(err.message);
      } else {
        const message = err instanceof Error ? err.message : "Failed";
        toast.error(message);
      }
      setSubmitting(false);
    }
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 md:p-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New eval fixture</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste one URL per line. Each line must be an absolute http(s) URL.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit(e);
          }}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="fixture-name"
              className="block text-sm font-medium"
            >
              Fixture name (optional)
            </label>
            <input
              id="fixture-name"
              type="text"
              {...register("name")}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="my-fixture"
            />
          </div>

          <div>
            <label htmlFor="fixture-urls" className="block text-sm font-medium">
              URLs
            </label>
            <textarea
              id="fixture-urls"
              rows={10}
              {...register("urls")}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="https://example.com/post-1&#10;https://example.com/post-2"
              aria-describedby="fixture-urls-help"
            />
            <p
              id="fixture-urls-help"
              className="mt-1 text-xs text-muted-foreground"
            >
              {validUrls.length} valid URL{validUrls.length === 1 ? "" : "s"}
              {hasInvalidLine ? " — fix invalid lines below" : ""}
            </p>
            {hasInvalidLine ? (
              <ul
                className="mt-2 space-y-1 text-xs"
                data-testid="invalid-lines"
              >
                {parsed.map((p, idx) =>
                  !p.isBlank && !p.isValid ? (
                    <li
                      key={`${String(idx)}-${p.line}`}
                      className="flex items-center gap-2 text-red-600"
                    >
                      <span aria-hidden="true">●</span>
                      <span>
                        Line {String(idx + 1)}: invalid URL ({p.trimmed.slice(0, 80)})
                      </span>
                    </li>
                  ) : null,
                )}
              </ul>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2
                  className="size-4 animate-spin"
                  data-testid="submit-spinner"
                  aria-hidden="true"
                />
              ) : null}
              Build fixture
            </button>
            {submitting ? (
              <span className="text-sm text-muted-foreground">
                Creating fixture…
              </span>
            ) : null}
          </div>
        </form>
      </main>
    </div>
  );
}
