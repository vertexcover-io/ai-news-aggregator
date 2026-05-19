import type { ReactElement } from "react";
import { COST_TRACKING_LAUNCHED_AT } from "@newsletter/shared/constants";
import type {
  CostStage,
  ModelStageCost,
  RunCostBreakdown,
  RunSummary,
  StageCost,
} from "@newsletter/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCostUsd, formatTokens } from "./cost-format";

interface CostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: RunSummary | null;
}

const STAGE_ORDER: CostStage[] = [
  "web-discovery",
  "web-extraction",
  "rank",
  "recap",
];

const STAGE_LABELS: Record<CostStage, string> = {
  "web-discovery": "Web discovery",
  "web-extraction": "Web extraction",
  rank: "Rank",
  recap: "Recap",
};

function formatRunDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function CostDialog({
  open,
  onOpenChange,
  run,
}: CostDialogProps): ReactElement | null {
  if (run === null) return null;
  // Coerce undefined to null: API responses from older deploys can omit the
  // field entirely. The empty-state path handles both pre-feature runs and
  // missing-field responses identically.
  const cb = run.costBreakdown ?? null;
  const isValid = cb !== null && (cb.schemaVersion as number) === 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Cost breakdown — Run {formatRunDate(run.startedAt)}
          </DialogTitle>
          <DialogDescription>
            {isValid
              ? `Total: ${formatCostUsd(cb.totalCostUsd)}`
              : "Per-stage cost breakdown for this run."}
          </DialogDescription>
        </DialogHeader>
        {isValid ? <CostTable breakdown={cb} /> : <EmptyState />}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState(): ReactElement {
  return (
    <div className="py-8 text-center">
      <p className="text-sm text-muted-foreground">
        No cost data for this run.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Cost tracking was added on {COST_TRACKING_LAUNCHED_AT}; this run
        pre-dates that change.
      </p>
    </div>
  );
}

function CostTable({
  breakdown,
}: {
  breakdown: RunCostBreakdown;
}): ReactElement {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stage</TableHead>
            <TableHead>Calls</TableHead>
            <TableHead>In tok</TableHead>
            <TableHead>Out tok</TableHead>
            <TableHead>Cached</TableHead>
            <TableHead>Thinking</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {STAGE_ORDER.map((stage) => {
            const sc = breakdown.stages[stage];
            if (sc === undefined || sc.calls === 0) {
              return <ZeroRow key={stage} stage={stage} />;
            }
            if (sc.byModel.length === 1) {
              return (
                <SingleModelRow
                  key={stage}
                  stage={stage}
                  sc={sc}
                  model={sc.byModel[0]}
                />
              );
            }
            return [
              <AggregateRow key={`${stage}-agg`} stage={stage} sc={sc} />,
              ...sc.byModel.map((m) => (
                <PerModelRow
                  key={`${stage}-${m.modelId}`}
                  stage={stage}
                  model={m}
                />
              )),
            ];
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function StageLabel({ stage }: { stage: CostStage }): ReactElement {
  return <span>{STAGE_LABELS[stage]}</span>;
}

function ZeroRow({ stage }: { stage: CostStage }): ReactElement {
  return (
    <TableRow data-stage={stage}>
      <TableCell>
        <StageLabel stage={stage} />
      </TableCell>
      <TableCell>—</TableCell>
      <TableCell>—</TableCell>
      <TableCell>—</TableCell>
      <TableCell>—</TableCell>
      <TableCell>—</TableCell>
      <TableCell>—</TableCell>
      <TableCell>—</TableCell>
    </TableRow>
  );
}

function CostCell({
  costUsd,
  costStatus,
  unknownModelIds,
}: {
  costUsd: number | null;
  costStatus?: StageCost["costStatus"];
  unknownModelIds?: string[];
}): ReactElement {
  const warn = costStatus !== undefined && costStatus !== "ok";
  return (
    <TableCell>
      <span>{formatCostUsd(costUsd)}</span>
      {warn ? (
        <span
          data-testid="cost-cell-warning"
          title={
            unknownModelIds && unknownModelIds.length > 0
              ? `Unknown pricing: ${unknownModelIds.join(", ")}`
              : "Cost data incomplete"
          }
          className="ml-1.5 inline-block h-2 w-2 rounded-full bg-amber-500"
          aria-label="Cost data incomplete"
        />
      ) : null}
    </TableCell>
  );
}

function SingleModelRow({
  stage,
  sc,
  model,
}: {
  stage: CostStage;
  sc: StageCost;
  model: ModelStageCost;
}): ReactElement {
  const unknownIds = sc.byModel.filter((m) => m.costUsd === null).map((m) => m.modelId);
  return (
    <TableRow data-stage={stage}>
      <TableCell>
        <StageLabel stage={stage} />
      </TableCell>
      <TableCell>{formatTokens(sc.calls)}</TableCell>
      <TableCell>{formatTokens(model.inputTokens)}</TableCell>
      <TableCell>{formatTokens(model.outputTokens)}</TableCell>
      <TableCell>{formatTokens(model.cachedInputTokens)}</TableCell>
      <TableCell>{formatTokens(model.reasoningTokens)}</TableCell>
      <TableCell className="font-mono text-xs">{model.modelId}</TableCell>
      <CostCell
        costUsd={sc.costUsd}
        costStatus={sc.costStatus}
        unknownModelIds={unknownIds}
      />
    </TableRow>
  );
}

function AggregateRow({
  stage,
  sc,
}: {
  stage: CostStage;
  sc: StageCost;
}): ReactElement {
  const inputTokens = sc.byModel.reduce((s, m) => s + m.inputTokens, 0);
  const outputTokens = sc.byModel.reduce((s, m) => s + m.outputTokens, 0);
  const cachedTokens = sc.byModel.reduce((s, m) => s + m.cachedInputTokens, 0);
  const thinkingTokens = sc.byModel.reduce((s, m) => s + m.reasoningTokens, 0);
  const unknownIds = sc.byModel.filter((m) => m.costUsd === null).map((m) => m.modelId);
  return (
    <TableRow data-stage={stage} className="font-medium">
      <TableCell>
        <StageLabel stage={stage} />
      </TableCell>
      <TableCell>{formatTokens(sc.calls)}</TableCell>
      <TableCell>{formatTokens(inputTokens)}</TableCell>
      <TableCell>{formatTokens(outputTokens)}</TableCell>
      <TableCell>{formatTokens(cachedTokens)}</TableCell>
      <TableCell>{formatTokens(thinkingTokens)}</TableCell>
      <TableCell className="text-muted-foreground">
        {sc.byModel.length} models
      </TableCell>
      <CostCell
        costUsd={sc.costUsd}
        costStatus={sc.costStatus}
        unknownModelIds={unknownIds}
      />
    </TableRow>
  );
}

function PerModelRow({
  stage,
  model,
}: {
  stage: CostStage;
  model: ModelStageCost;
}): ReactElement {
  return (
    <TableRow data-stage={stage} className="text-muted-foreground">
      <TableCell className="pl-8 text-xs">↳</TableCell>
      <TableCell>{formatTokens(model.calls)}</TableCell>
      <TableCell>{formatTokens(model.inputTokens)}</TableCell>
      <TableCell>{formatTokens(model.outputTokens)}</TableCell>
      <TableCell>{formatTokens(model.cachedInputTokens)}</TableCell>
      <TableCell>{formatTokens(model.reasoningTokens)}</TableCell>
      <TableCell className="font-mono text-xs">{model.modelId}</TableCell>
      <CostCell costUsd={model.costUsd} />
    </TableRow>
  );
}
