import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import type { RunStatus } from "@newsletter/shared/types";
import { useRunObservability } from "../hooks/useRunObservability";
import { RunFunnel } from "../components/observability/RunFunnel";
import { StageTimingRail } from "../components/observability/StageTimingRail";
import { CostStrip } from "../components/observability/CostStrip";
import { SourceTelemetryTable } from "../components/observability/SourceTelemetryTable";
import { EnrichmentStrip } from "../components/observability/EnrichmentStrip";
import { FailuresList } from "../components/observability/FailuresList";
import { DebugTimeline } from "../components/observability/DebugTimeline";
import { LiveStatusPill } from "../components/observability/LiveStatusPill";
import { formatClock, formatElapsed } from "../components/observability/format";

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
]);

function SectionHead({
  title,
  note,
}: {
  title: string;
  note: string;
}): ReactElement {
  return (
    <div className="mb-4 flex items-baseline justify-between border-b border-line pb-2">
      <div className="font-serif text-[19px] font-semibold tracking-tight text-ink">
        {title}
      </div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-mute-2">
        {note}
      </div>
    </div>
  );
}

export function RunObservabilityPage(): ReactElement {
  const params = useParams<{ runId: string }>();
  const runId = params.runId ?? null;
  const query = useRunObservability(runId);

  if (query.isLoading || (!query.isFetched && query.data === undefined)) {
    return (
      <div
        data-testid="run-loading"
        className="mx-auto max-w-[1180px] px-4 py-24 text-center font-mono text-sm text-mute sm:px-6 md:px-8"
      >
        Loading run telemetry…
      </div>
    );
  }

  const data = query.data;
  if (data === null || data === undefined) {
    return (
      <div
        data-testid="run-not-found"
        className="mx-auto max-w-[1180px] px-4 py-24 text-center sm:px-6 md:px-8"
      >
        <div className="font-serif text-2xl text-ink">Run not found</div>
        <p className="mt-2 font-mono text-sm text-mute">
          No run-state or archive exists for this id.
        </p>
        <Link
          to="/admin"
          className="mt-6 inline-block font-mono text-xs uppercase tracking-widest text-rust underline"
        >
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  const { run, funnel, stages, cost, sources, enrichment, failures, logs, live } =
    data;
  const isTerminal = TERMINAL.has(run.status);
  const rankedTarget = funnel.ranked;
  const reachedStages = stages.filter((s) => s.startedAt !== null).length;

  return (
    <div className="bg-cream">
      <div className="mx-auto max-w-[1180px] px-4 pb-24 sm:px-6 md:px-8">
        <div className="mt-6 flex items-center gap-2 font-mono text-[11px] text-mute-2">
          <Link to="/admin" className="text-rust no-underline">
            Dashboard
          </Link>
          <span>/</span>
          <span>Runs</span>
          <span>/</span>
          <span className="break-all">{run.runId}</span>
        </div>

        <div className="grid grid-cols-1 items-end gap-6 border-b-[1.5px] border-ink py-4 md:grid-cols-[1fr_auto]">
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-mute-2">
              Run Ledger · Observability
            </div>
            <h1 className="mt-2.5 mb-1.5 font-serif text-[40px] font-medium leading-[1.04] tracking-tight text-ink">
              Run telemetry
            </h1>
            <div className="font-mono text-xs text-mute">
              run <b className="font-medium text-ink-2">{run.runId}</b>
              {run.isDryRun ? (
                <span
                  data-testid="dry-run-label"
                  className="ml-2 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                >
                  Dry run
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <LiveStatusPill
              status={run.status}
              stage={run.stage}
              live={live && !isTerminal}
            />
            <div className="flex flex-wrap gap-4 font-mono text-[11.5px] text-mute md:justify-end">
              <span>
                started{" "}
                <b className="font-medium text-ink-2">
                  {formatClock(run.startedAt)}
                </b>
              </span>
              <span>
                {isTerminal ? "elapsed" : "elapsed"}{" "}
                <b className="font-medium text-ink-2">
                  {formatElapsed(run.startedAt, run.completedAt)}
                </b>
              </span>
              <span>
                stage{" "}
                <b className="font-medium text-ink-2">
                  {String(reachedStages)} / {String(Math.max(stages.length, 5))}
                </b>
              </span>
            </div>
          </div>
        </div>
        {live && !isTerminal ? (
          <div className="relative -mt-px h-0.5 overflow-hidden bg-line">
            <div className="absolute inset-y-0 w-3/5 animate-pulse bg-gradient-to-r from-transparent to-rust" />
          </div>
        ) : null}

        <section className="mt-9">
          <SectionHead title="Pipeline Funnel" note="collected → ranked" />
          <div className="grid grid-cols-1 gap-7 lg:grid-cols-[1.05fr_1fr]">
            <RunFunnel funnel={funnel} topN={rankedTarget} />
            <div>
              <StageTimingRail stages={stages} />
              <CostStrip cost={cost} live={live && !isTerminal} />
            </div>
          </div>
        </section>

        <section className="mt-9">
          <SectionHead
            title="Source Telemetry"
            note={`per-source · ${String(sources.length)} units`}
          />
          <SourceTelemetryTable sources={sources} />
        </section>

        <section className="mt-9">
          <SectionHead title="Link Enrichment" note="adaptive fetch" />
          <EnrichmentStrip enrichment={enrichment} />
        </section>

        <section className="mt-9">
          <SectionHead
            title="Failures"
            note={`level = error · ${String(failures.length)}`}
          />
          <FailuresList failures={failures} />
        </section>

        <section className="mt-9">
          <SectionHead title="Debug Timeline" note={`${String(logs.length)} events`} />
          <DebugTimeline logs={logs} />
        </section>

        <div className="mt-14 flex justify-between border-t border-line pt-4 font-mono text-[10.5px] tracking-wide text-mute-2">
          <span>
            {live && !isTerminal
              ? "Live · refreshing every 2s · stops on completion"
              : "Historical · persisted telemetry"}
          </span>
          <span>* rank cost is a running estimate until finalize</span>
        </div>
      </div>
    </div>
  );
}
