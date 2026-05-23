import { useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { SOURCE_TYPE_SECTION_LABELS } from "@newsletter/shared/constants";
import type {
  SourceFailureSummary,
  SourcesSummaryResponse,
  SourcesSummaryRow,
  SourcesSummarySection,
} from "@newsletter/shared/types";
import { fetchSourcesSummary } from "@/api/sources";

type PresetId = "24h" | "7d" | "30d" | "90d" | "custom";

interface Range {
  from: Date;
  to: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function presetRange(p: Exclude<PresetId, "custom">, now: Date): Range {
  const days = p === "24h" ? 1 : p === "7d" ? 7 : p === "30d" ? 30 : 90;
  return { from: new Date(now.getTime() - days * MS_PER_DAY), to: now };
}

function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fromInputDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatRangeLabel(range: Range): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  return `${range.from.toLocaleDateString("en-US", opts)} → ${range.to.toLocaleDateString("en-US", opts)}`;
}

function formatPct(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${String(Math.round((num / denom) * 100))}%`;
}

function totalsOf(sections: SourcesSummarySection[]): {
  sources: number;
  active: number;
  fetched: number;
  used: number;
  failureSources: number;
} {
  let sources = 0;
  let active = 0;
  let fetched = 0;
  let used = 0;
  let failureSources = 0;
  for (const s of sections) {
    for (const r of s.rows) {
      sources += 1;
      if (r.fetchedCount > 0) active += 1;
      fetched += r.fetchedCount;
      used += r.usedCount;
      if (r.failureCount > 0) failureSources += 1;
    }
  }
  return { sources, active, fetched, used, failureSources };
}

function PresetButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "font-mono text-[11.5px] tracking-[0.06em] border rounded-full px-3 py-1",
        active
          ? "bg-[#14110d] text-white border-[#14110d]"
          : "bg-transparent text-[#6b6557] border-[#e7e2d6] hover:text-[#14110d] hover:border-[#a39a86]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function RangeStrip({
  preset,
  range,
  onPreset,
  onCustom,
}: {
  preset: PresetId;
  range: Range;
  onPreset: (p: Exclude<PresetId, "custom">) => void;
  onCustom: (from: Date, to: Date) => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#e7e2d6] bg-white p-3">
      <span className="mr-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#6b6557]">
        Range
      </span>
      <PresetButton
        label="24h"
        active={preset === "24h"}
        onClick={() => {
          onPreset("24h");
        }}
      />
      <PresetButton
        label="7d"
        active={preset === "7d"}
        onClick={() => {
          onPreset("7d");
        }}
      />
      <PresetButton
        label="30d"
        active={preset === "30d"}
        onClick={() => {
          onPreset("30d");
        }}
      />
      <PresetButton
        label="90d"
        active={preset === "90d"}
        onClick={() => {
          onPreset("90d");
        }}
      />
      <span className="px-1 text-[#a39a86]">·</span>
      <input
        type="date"
        aria-label="From"
        value={toInputDate(range.from)}
        onChange={(e) => {
          const d = fromInputDate(e.target.value);
          if (d) onCustom(d, range.to);
        }}
        className="rounded border border-[#e7e2d6] bg-white px-2 py-1 font-mono text-[11.5px] text-[#14110d]"
      />
      <span className="px-1 text-[#a39a86]">→</span>
      <input
        type="date"
        aria-label="To"
        value={toInputDate(range.to)}
        onChange={(e) => {
          const d = fromInputDate(e.target.value);
          if (d) onCustom(range.from, d);
        }}
        className="rounded border border-[#e7e2d6] bg-white px-2 py-1 font-mono text-[11.5px] text-[#14110d]"
      />
      <span className="ml-auto rounded bg-[#f5f2e9] px-2.5 py-1 font-mono text-[11px] text-[#6b6557]">
        <strong className="text-[#14110d]">{formatRangeLabel(range)}</strong>
      </span>
    </div>
  );
}

function StatBand({
  totals,
  runsInRange,
}: {
  totals: ReturnType<typeof totalsOf>;
  runsInRange: number;
}): ReactElement {
  const usedPct = formatPct(totals.used, totals.fetched);
  return (
    <dl className="grid grid-cols-2 gap-0 rounded-md border border-[#e7e2d6] bg-white p-5 sm:grid-cols-4">
      <Stat
        label="Active sources"
        value={String(totals.active)}
        sub="produced ≥ 1 item"
      />
      <Stat
        label="Total fetched"
        value={String(totals.fetched)}
        sub={`${String(runsInRange)} run${runsInRange === 1 ? "" : "s"} in range`}
      />
      <Stat
        label="Total used"
        value={String(totals.used)}
        accent
        sub={`${usedPct} of fetched`}
      />
      <Stat
        label="Failures"
        value={String(totals.failureSources)}
        warn={totals.failureSources > 0}
        sub="sources w/ ≥ 1 failure"
      />
    </dl>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
  warn,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  warn?: boolean;
}): ReactElement {
  return (
    <div className="px-0 sm:px-5 sm:[&:not(:first-child)]:border-l sm:border-[#e7e2d6]">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#6b6557]">
        {label}
      </div>
      <div
        className={[
          "mt-1.5 font-serif text-[26px] font-medium leading-none tabular-nums tracking-[-0.01em]",
          accent ? "text-[#8c3a1e]" : "",
          warn ? "text-[#8c3a1e]" : "",
        ].join(" ")}
      >
        {value}
      </div>
      <div className="mt-1.5 font-mono text-[10.5px] text-[#a39a86]">{sub}</div>
    </div>
  );
}

function ErrorStrip({
  failures,
  range,
}: {
  failures: SourceFailureSummary[];
  range: Range;
}): ReactElement | null {
  if (failures.length === 0) return null;
  return (
    <div
      role="alert"
      className="rounded border border-[#f4d3a8] bg-[#fef2e6] p-4"
    >
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="m-0 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[#8c3a1e]">
          Failures · in range
        </h3>
        <span className="font-mono text-[10.5px] text-[#6b6557]">
          {formatRangeLabel(range)} · {failures.length} source
          {failures.length === 1 ? "" : "s"} affected
        </span>
      </div>
      <ul className="m-0 list-none p-0">
        {failures.map((f) => (
          <li
            key={`${f.sourceType}:${f.identifier}`}
            className="grid grid-cols-[100px_1fr_auto] items-baseline gap-3 border-t border-dashed border-[#f4d3a8] py-1.5 first:border-t-0 first:pt-0 font-mono text-[12px] text-[#14110d]"
          >
            <span className="text-[10.5px] uppercase tracking-[0.12em] text-[#8c3a1e]">
              {f.sourceType}
            </span>
            <span>
              <strong className="font-medium">{f.displayName}</strong> —{" "}
              {f.lastErrorMessage}
            </span>
            <span className="text-right text-[11px] text-[#6b6557]">
              {f.runsAffected} run{f.runsAffected === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function compareRowsAlpha(
  a: SourcesSummaryRow,
  b: SourcesSummaryRow,
): number {
  return a.displayName
    .toLowerCase()
    .localeCompare(b.displayName.toLowerCase());
}

function Section({
  section,
  showColumnHeader,
}: {
  section: SourcesSummarySection;
  showColumnHeader: boolean;
}): ReactElement {
  const rows = useMemo(
    () => [...section.rows].sort(compareRowsAlpha),
    [section.rows],
  );
  const totalFetched = rows.reduce((acc, r) => acc + r.fetchedCount, 0);
  const totalUsed = rows.reduce((acc, r) => acc + r.usedCount, 0);
  const pct = formatPct(totalUsed, totalFetched);

  return (
    <section className="pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[#8c3a1e] pb-1">
        <h2 className="m-0 font-mono text-[12px] font-medium uppercase tracking-[0.22em] text-[#14110d]">
          {SOURCE_TYPE_SECTION_LABELS[section.sourceType]}
        </h2>
        <span className="font-mono text-[10.5px] tabular-nums text-[#a39a86]">
          <span className="text-[#8c3a1e]">{totalUsed}</span> / {totalFetched}{" "}
          used · {pct}
        </span>
      </div>
      {showColumnHeader ? <ColumnHeader /> : null}
      <div className="divide-y divide-[#efeadd]">
        {rows.map((r) => (
          <Row key={`${section.sourceType}:${r.identifier}`} row={r} />
        ))}
      </div>
    </section>
  );
}

function ColumnHeader(): ReactElement {
  return (
    <div className="hidden grid-cols-[1fr_72px_72px_72px_100px] items-baseline gap-3 pt-2 pb-1 sm:grid">
      <span />
      <span className="text-right font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#a39a86]">
        Fetched
      </span>
      <span className="text-right font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#a39a86]">
        Used
      </span>
      <span className="text-right font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#a39a86]">
        Used %
      </span>
      <span className="text-right font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#a39a86]">
        Failures
      </span>
    </div>
  );
}

function Row({ row }: { row: SourcesSummaryRow }): ReactElement {
  const failed = row.failureCount > 0;
  const usedPct = formatPct(row.usedCount, row.fetchedCount);
  return (
    <div
      data-source-row="true"
      className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[1fr_72px_72px_72px_100px] sm:items-baseline sm:gap-3"
    >
      <div className="flex items-baseline gap-2">
        {row.url !== null && row.url.length > 0 ? (
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-serif text-[15.5px] font-medium leading-[1.3] text-[#14110d] hover:text-[#8c3a1e]"
          >
            {row.displayName}
          </a>
        ) : (
          <span className="font-serif text-[15.5px] font-medium leading-[1.3] text-[#14110d]">
            {row.displayName}
          </span>
        )}
        {failed ? (
          <span
            title={row.lastFailureMessage ?? undefined}
            className="rounded-sm bg-[#fef2e6] px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[#8c3a1e]"
          >
            Failing
          </span>
        ) : null}
      </div>
      <span
        className={`hidden text-right font-mono text-[12.5px] tabular-nums sm:inline ${
          row.fetchedCount === 0 ? "text-[#c2b89f]" : "text-[#14110d]"
        }`}
      >
        {row.fetchedCount}
      </span>
      <span
        className={`hidden text-right font-mono text-[12.5px] tabular-nums sm:inline ${
          row.usedCount === 0 ? "text-[#c2b89f]" : "text-[#14110d]"
        }`}
      >
        {row.usedCount}
      </span>
      <span
        className={`hidden text-right font-mono text-[12.5px] tabular-nums sm:inline ${
          row.usedCount > 0 ? "text-[#8c3a1e]" : "text-[#a39a86]"
        }`}
      >
        {usedPct}
      </span>
      <span
        className={`hidden text-right font-mono text-[11.5px] tabular-nums sm:inline ${
          failed ? "text-[#8c3a1e]" : "text-[#a39a86]"
        }`}
        title={row.lastFailureMessage ?? undefined}
      >
        {failed
          ? `${String(row.failureCount)} run${row.failureCount === 1 ? "" : "s"}`
          : "—"}
      </span>
      <div className="flex flex-wrap gap-3 font-mono text-[11.5px] text-[#6b6557] sm:hidden">
        <span>
          Fetched <span className="text-[#14110d]">{row.fetchedCount}</span>
        </span>
        <span>
          Used <span className="text-[#14110d]">{row.usedCount}</span>
        </span>
        <span className={row.usedCount > 0 ? "text-[#8c3a1e]" : "text-[#a39a86]"}>
          {usedPct}
        </span>
        {failed ? (
          <span className="text-[#8c3a1e]">
            {row.failureCount} run{row.failureCount === 1 ? "" : "s"} failed
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RankingPromptPanel({ prompt }: { prompt: string }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-8 border-t border-[#8c3a1e] pt-2">
      <div className="flex items-baseline justify-between">
        <h3 className="m-0 font-mono text-[12px] font-medium uppercase tracking-[0.22em] text-[#14110d]">
          Ranking Prompt
        </h3>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
          }}
          className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#6b6557] hover:text-[#8c3a1e]"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      <p className="mt-2 font-serif text-[14px] italic leading-[1.5] text-[#6b6557]">
        Live system prompt used to rerank the day&apos;s stories. Edits in
        admin settings take effect on the next run.
      </p>
      {open ? (
        <pre className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-sm border border-[#efeadd] bg-[#f5f2e9] p-3 font-mono text-[12px] leading-[1.55] text-[#14110d]">
          {prompt}
        </pre>
      ) : null}
    </section>
  );
}

interface SourcesTabState {
  preset: PresetId;
  range: Range;
}

function initialState(now: Date): SourcesTabState {
  return { preset: "7d", range: presetRange("7d", now) };
}

export function SourcesTab(): ReactElement {
  const [state, setState] = useState<SourcesTabState>(() =>
    initialState(new Date()),
  );

  const { data, isLoading, isError } = useQuery<SourcesSummaryResponse>({
    queryKey: [
      "sources-summary",
      state.range.from.toISOString(),
      state.range.to.toISOString(),
    ],
    queryFn: () =>
      fetchSourcesSummary({
        from: state.range.from.toISOString(),
        to: state.range.to.toISOString(),
      }),
  });

  const onPreset = (p: Exclude<PresetId, "custom">): void => {
    setState({ preset: p, range: presetRange(p, new Date()) });
  };
  const onCustom = (from: Date, to: Date): void => {
    if (from >= to) return;
    setState({ preset: "custom", range: { from, to } });
  };

  return (
    <div className="space-y-4">
      <RangeStrip
        preset={state.preset}
        range={state.range}
        onPreset={onPreset}
        onCustom={onCustom}
      />

      {isLoading && (
        <p className="py-8 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#6b6557]">
          Loading…
        </p>
      )}
      {isError && (
        <p className="py-8 text-center font-mono text-[11px] text-red-700">
          Failed to load sources
        </p>
      )}
      {data && (
        <>
          <ErrorStrip failures={data.failures} range={state.range} />
          <StatBand
            totals={totalsOf(data.sections)}
            runsInRange={data.range.runsInRange}
          />
          {data.sections.map((s, i) => (
            <Section
              key={s.sourceType}
              section={s}
              showColumnHeader={i === 0}
            />
          ))}
          {data.sections.length === 0 && (
            <p className="py-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[#6b6557]">
              No source data in this range.
            </p>
          )}
          <RankingPromptPanel prompt={data.rankingPrompt} />
        </>
      )}
    </div>
  );
}
