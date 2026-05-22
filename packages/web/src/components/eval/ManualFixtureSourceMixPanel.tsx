import type { ReactElement } from "react";

export type SourceBucket = "hn" | "reddit" | "twitter" | "web";

export interface SourceMix {
  hn: number;
  reddit: number;
  twitter: number;
  web: number;
  total: number;
}

const BUCKET_COLOR: Record<SourceBucket, string> = {
  hn: "#c2410c",
  reddit: "#ea580c",
  twitter: "#0369a1",
  web: "#78716c",
};

const BUCKET_LABEL: Record<SourceBucket, string> = {
  hn: "HN",
  reddit: "Reddit",
  twitter: "Twitter",
  web: "Web",
};

export function classifyUrl(rawUrl: string): SourceBucket {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "web";
  }
  if (host === "news.ycombinator.com" || host.endsWith(".ycombinator.com")) {
    return "hn";
  }
  if (host === "reddit.com" || host.endsWith(".reddit.com")) return "reddit";
  if (
    host === "x.com" ||
    host.endsWith(".x.com") ||
    host === "twitter.com" ||
    host.endsWith(".twitter.com")
  ) {
    return "twitter";
  }
  return "web";
}

export function computeSourceMix(urls: string[]): SourceMix {
  const mix: SourceMix = { hn: 0, reddit: 0, twitter: 0, web: 0, total: 0 };
  for (const u of urls) {
    const bucket = classifyUrl(u);
    mix[bucket] += 1;
    mix.total += 1;
  }
  return mix;
}

export interface ManualFixtureSourceMixPanelProps {
  urls: string[];
}

export function ManualFixtureSourceMixPanel(
  props: ManualFixtureSourceMixPanelProps,
): ReactElement {
  const mix = computeSourceMix(props.urls);
  const buckets: SourceBucket[] = ["hn", "reddit", "twitter", "web"];

  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <header className="px-5 py-3 border-b border-stone-200 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone-900">
          Source mix
        </span>
        <span className="font-mono text-[11px] text-stone-500">
          of {String(mix.total)} valid
        </span>
      </header>
      <div className="px-5 py-4">
        <div className="flex h-2.5 rounded overflow-hidden bg-stone-100 mt-3">
          {mix.total === 0
            ? null
            : buckets.map((b) =>
                mix[b] === 0 ? null : (
                  <span
                    key={b}
                    style={{
                      background: BUCKET_COLOR[b],
                      width: `${String((mix[b] / mix.total) * 100)}%`,
                    }}
                  />
                ),
              )}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 font-mono text-[11px] text-stone-500">
          {buckets.map((b) => (
            <span key={b} className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-sm"
                style={{ background: BUCKET_COLOR[b] }}
              />
              {BUCKET_LABEL[b]} · {String(mix[b])}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-stone-500 leading-snug">
          Aim for diversity. A fixture dominated by one source teaches the
          ranker to over-fit on that source&apos;s style.
        </p>
      </div>
    </div>
  );
}
