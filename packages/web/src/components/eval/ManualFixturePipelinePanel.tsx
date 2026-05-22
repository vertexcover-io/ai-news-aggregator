import type { ReactElement } from "react";

interface Step {
  title: string;
  body: ReactElement | string;
}

const STEPS: Step[] = [
  {
    title: "Resolve collectors",
    body: "URL classifier matches each URL to its native collector — HN, Reddit, Twitter, GitHub. Anything that doesn't match a known source falls back to web fetch + Readability.",
  },
  {
    title: "Fetch in parallel",
    body: "HN / Reddit / Twitter / GitHub native collectors run; everything else goes through fetch + Readability for OG image, title, description.",
  },
  {
    title: "Dedup & cluster",
    body: "URL normalization + title-similarity merge cross-source duplicates.",
  },
  {
    title: "Open grading view",
    body: (
      <>
        You&apos;ll be redirected to{" "}
        <span className="font-mono">/admin/eval/grade/&lt;id&gt;</span> to label
        each cluster as must / nice / drop. Save-to-repo then lands you on{" "}
        <span className="font-mono">/admin/eval</span> with the fixture
        pre-selected — ready to run a scored eval.
      </>
    ),
  },
];

export function ManualFixturePipelinePanel(): ReactElement {
  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <header className="px-5 py-3 border-b border-stone-200 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone-900">
          Pipeline
        </span>
        <span className="font-mono text-[11px] text-stone-500">on submit</span>
      </header>
      <div className="px-5 py-4 flex flex-col">
        {STEPS.map((s, idx) => (
          <div
            key={s.title}
            className="grid grid-cols-[24px_1fr] gap-3 py-3 border-b border-stone-200 last:border-b-0 text-[13px]"
          >
            <span className="pt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-stone-400">
              {String(idx + 1).padStart(2, "0")}
            </span>
            <div>
              <div className="font-medium text-stone-900 mb-0.5">{s.title}</div>
              <div className="text-[12px] text-stone-500 leading-snug">
                {s.body}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
