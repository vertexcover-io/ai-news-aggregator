import type { ReactElement } from "react";
import type { LlmStage, RunCostBreakdown, StageCost } from "@newsletter/shared";

const PRICING_LAST_VERIFIED = "2026-05-18";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STAGE_LABELS: Record<LlmStage, string> = {
  webListing: "Web listing",
  webExtraction: "Web extraction",
  rank: "Rank",
  recap: "Recap",
};

const STAGE_ORDER: LlmStage[] = ["webListing", "webExtraction", "rank", "recap"];

function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

function formatTokens(n: number): string {
  return n.toLocaleString();
}

function formatStageWarning(stage: StageCost): string | null {
  const warnings = [
    (stage.missingUsageCallCount ?? 0) > 0
      ? `${String(stage.missingUsageCallCount)} call(s) missing usage`
      : null,
    (stage.unknownModelCallCount ?? 0) > 0
      ? `${String(stage.unknownModelCallCount)} call(s) unknown model: ${stage.model}`
      : null,
  ].filter((warning): warning is string => warning !== null);

  return warnings.length > 0 ? warnings.join(" · ") : null;
}

function StageRow({ label, stage }: { label: string; stage: StageCost }): ReactElement {
  const warning = formatStageWarning(stage);
  return (
    <tr className="border-b last:border-b-0">
      <td className="py-2 pr-3 align-top">
        <div className="flex items-center gap-2">
          <span>{label}</span>
          {warning ? (
            <Badge variant="destructive" className="text-[10px] py-0 px-1.5">
              warning
            </Badge>
          ) : null}
        </div>
        {warning ? (
          <div className="text-xs text-muted-foreground mt-1">
            {warning}
          </div>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{stage.callCount}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{formatTokens(stage.inputTokens)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {formatTokens(stage.cacheCreationInputTokens ?? 0)}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {formatTokens(stage.cacheReadInputTokens ?? 0)}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{formatTokens(stage.outputTokens)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {formatTokens(stage.totalTokens ?? stage.inputTokens + stage.outputTokens)}
      </td>
      <td className="py-2 text-right tabular-nums">{formatUsd(stage.usdCost)}</td>
    </tr>
  );
}


export interface CostBreakdownCardProps {
  costBreakdown: RunCostBreakdown | null;
}

export function CostBreakdownCard({
  costBreakdown,
}: CostBreakdownCardProps): ReactElement {
  if (!costBreakdown) {
    return (
      <Card data-testid="cost-breakdown-card">
        <CardHeader>
          <CardTitle>Pipeline cost</CardTitle>
          <CardDescription>API spend per stage</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No cost data captured for this run.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="cost-breakdown-card">
      <CardHeader>
        <CardTitle>Pipeline cost</CardTitle>
        <CardDescription>API spend per stage</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="py-2 pr-3 text-left font-medium">Stage</th>
                <th className="py-2 pr-3 text-right font-medium">Calls</th>
                <th className="py-2 pr-3 text-right font-medium">Input tokens</th>
                <th className="py-2 pr-3 text-right font-medium">Cache write</th>
                <th className="py-2 pr-3 text-right font-medium">Cache read</th>
                <th className="py-2 pr-3 text-right font-medium">Output tokens</th>
                <th className="py-2 pr-3 text-right font-medium">Total tokens</th>
                <th className="py-2 text-right font-medium">USD</th>
              </tr>
            </thead>
            <tbody>
              {STAGE_ORDER.map((stageKey) => {
                const stage = costBreakdown.stages[stageKey];
                if (!stage) return null;
                return (
                  <StageRow
                    key={stageKey}
                    label={STAGE_LABELS[stageKey]}
                    stage={stage}
                  />
                );
              })}
              <tr className="font-medium">
                <td className="pt-3 pr-3">Total</td>
                <td className="pt-3 pr-3" />
                <td className="pt-3 pr-3 text-right tabular-nums">
                  {formatTokens(costBreakdown.totalInputTokens)}
                </td>
                <td className="pt-3 pr-3 text-right tabular-nums">
                  {formatTokens(costBreakdown.totalCacheCreationInputTokens ?? 0)}
                </td>
                <td className="pt-3 pr-3 text-right tabular-nums">
                  {formatTokens(costBreakdown.totalCacheReadInputTokens ?? 0)}
                </td>
                <td className="pt-3 pr-3 text-right tabular-nums">
                  {formatTokens(costBreakdown.totalOutputTokens)}
                </td>
                <td className="pt-3 pr-3 text-right tabular-nums">
                  {formatTokens(
                    costBreakdown.totalTokens ??
                      costBreakdown.totalInputTokens +
                        costBreakdown.totalOutputTokens,
                  )}
                </td>
                <td className="pt-3 text-right tabular-nums">
                  {formatUsd(costBreakdown.totalUsdCost)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          Rates as of {PRICING_LAST_VERIFIED}
        </p>
      </CardContent>
    </Card>
  );
}
