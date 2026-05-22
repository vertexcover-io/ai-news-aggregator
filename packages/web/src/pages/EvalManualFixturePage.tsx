import { useMemo, useState, type ReactElement } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createManualFixture, EvalApiError } from "../api/eval";
import { ManualFixturePipelinePanel } from "../components/eval/ManualFixturePipelinePanel";
import { ManualFixtureSourceMixPanel } from "../components/eval/ManualFixtureSourceMixPanel";

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
  const invalidLines = useMemo(
    () =>
      parsed
        .map((p, idx) => ({ ...p, idx }))
        .filter((p) => !p.isBlank && !p.isValid),
    [parsed],
  );
  const hasInvalidLine = invalidLines.length > 0;
  const canSubmit = !submitting && validUrls.length >= 1 && !hasInvalidLine;

  const onSubmit = handleSubmit(async (values) => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await createManualFixture(validUrls, values.name);
      toast.success(`Fixture created with ${String(result.itemCount)} item(s)`);
      void navigate(
        `/admin/eval?fixtureId=${encodeURIComponent(result.fixtureId)}`,
      );
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
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-6 py-4 flex items-center justify-between">
        <Link
          to="/admin/eval"
          className="text-sm text-stone-500 hover:text-stone-900"
        >
          ← Back to eval
        </Link>
        <span className="font-mono text-[11px] text-stone-500">aman</span>
      </header>

      <div className="border-b border-stone-200 bg-white px-6 py-5">
        <div className="max-w-[1100px] mx-auto flex items-start justify-between gap-6">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone-500 mb-1">
              Eval · Build fixture
            </div>
            <h1
              className="font-serif text-3xl text-stone-900"
              style={{ fontFamily: "var(--font-serif, Newsreader), serif" }}
            >
              New manual fixture
            </h1>
            <p className="mt-1 text-sm text-stone-500 max-w-2xl">
              Paste URLs — one per line. On submit, each URL is routed through
              its native collector (HN, Reddit, Twitter, GitHub) when matched;
              anything else falls back to web fetch + Readability.
            </p>
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone-400 shrink-0">
            submit below
          </span>
        </div>
      </div>

      <main className="px-4 sm:px-6 md:px-8 py-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit(e);
          }}
          className="max-w-[1100px] mx-auto grid grid-cols-1 md:grid-cols-[1fr_360px] gap-6 items-start"
        >
          <section className="flex flex-col gap-5">
            <div className="bg-white border border-stone-200 rounded-lg p-5">
              <label
                htmlFor="fixture-name"
                className="block font-mono text-[11px] uppercase tracking-[0.1em] text-stone-500 mb-2"
              >
                Fixture name{" "}
                <span className="normal-case tracking-normal text-stone-400">
                  optional
                </span>
              </label>
              <input
                id="fixture-name"
                type="text"
                {...register("name")}
                className="block w-full rounded-md border border-stone-300 px-3 py-2 text-sm font-mono focus:border-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-900"
                placeholder="auto-generated from timestamp"
              />
              <span className="block mt-2 text-[11px] text-stone-500">
                Used as the fixture identifier in grading + eval runs.
              </span>
            </div>

            <section className="bg-white border border-stone-200 rounded-lg overflow-hidden">
              <header className="px-5 py-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
                <label
                  htmlFor="fixture-urls"
                  className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone-900"
                >
                  URLs · one per line
                </label>
                <span className="font-mono text-[11px] text-stone-500">
                  <strong className="text-emerald-700">
                    {String(validUrls.length)} valid
                  </strong>
                  {" · "}
                  <strong
                    className={
                      hasInvalidLine ? "text-rose-600" : "text-stone-400"
                    }
                  >
                    {String(invalidLines.length)} invalid
                  </strong>
                  {" · http(s) absolute"}
                </span>
              </header>
              <textarea
                id="fixture-urls"
                {...register("urls")}
                className="block w-full min-h-[320px] px-5 py-4 border-0 bg-white font-mono text-[13px] leading-relaxed text-stone-900 resize-y focus:outline-none"
                placeholder="https://example.com/post-1&#10;https://example.com/post-2"
                spellCheck={false}
                aria-describedby="fixture-urls-help"
              />
              <p id="fixture-urls-help" className="sr-only">
                {String(validUrls.length)} valid URLs
              </p>
            </section>

            {hasInvalidLine ? (
              <section
                className="rounded-lg border bg-rose-50"
                style={{ borderColor: "#fecaca" }}
              >
                <div className="px-5 py-3 flex flex-col gap-1">
                  <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-rose-600 mb-1">
                    <span>⚠</span>
                    <span>
                      {String(invalidLines.length)} invalid line
                      {invalidLines.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul
                    className="font-mono text-[12px] text-rose-600 flex flex-col gap-1"
                    data-testid="invalid-lines"
                  >
                    {invalidLines.map((p) => (
                      <li
                        key={`${String(p.idx)}-${p.line}`}
                        className="flex gap-3"
                      >
                        <span className="text-stone-400">
                          Line {String(p.idx + 1)}
                        </span>
                        <span>
                          invalid URL ({p.trimmed.slice(0, 80)}) — missing{" "}
                          <code>https://</code>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ) : null}

            <div className="flex items-center justify-between gap-4 pt-2">
              <span className="font-mono text-[11px] text-stone-500">
                On submit: fixture saved · you&apos;ll land on{" "}
                <span className="font-mono text-stone-900">/admin/eval</span>{" "}
                with this fixture selected
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void navigate("/admin/eval");
                  }}
                  className="text-sm rounded border border-stone-300 bg-white px-3 py-2 hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex items-center gap-2 rounded text-white px-4 py-2 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: "#8c3a1e" }}
                >
                  {submitting ? (
                    <Loader2
                      className="size-4 animate-spin"
                      data-testid="submit-spinner"
                      aria-hidden="true"
                    />
                  ) : null}
                  Build fixture · {String(validUrls.length)} URL
                  {validUrls.length === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          </section>

          <aside className="flex flex-col gap-4">
            <ManualFixturePipelinePanel />
            <ManualFixtureSourceMixPanel urls={validUrls} />
          </aside>
        </form>
      </main>
    </div>
  );
}
