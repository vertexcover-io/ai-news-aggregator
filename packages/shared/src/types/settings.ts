import type {
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitTwitterConfig,
  RunSubmitWebConfig,
  RunSubmitWebSearchConfig,
} from "./run.js";
import type { RunCostBreakdown } from "./cost-breakdown.js";

export interface UserSettings {
  id: string;
  topN: number;
  halfLifeHours: number | null;
  hnEnabled: boolean;
  hnConfig: RunSubmitHnConfig | null;
  redditEnabled: boolean;
  redditConfig: RunSubmitRedditConfig | null;
  webEnabled: boolean;
  webConfig: RunSubmitWebConfig | null;
  twitterEnabled: boolean;
  twitterConfig: RunSubmitTwitterConfig | null;
  webSearchEnabled: boolean;
  webSearchConfig: RunSubmitWebSearchConfig | null;
  posthogEnabled: boolean;
  posthogProjectToken: string | null;
  posthogHost: string | null;
  /** @deprecated Use pipelineTime. Kept as a read-only compatibility alias. */
  scheduleTime: string;
  pipelineTime: string;
  emailTime: string;
  linkedinTime: string;
  twitterTime: string;
  scheduleTimezone: string;
  scheduleEnabled: boolean;
  emailEnabled: boolean;
  linkedinEnabled: boolean;
  twitterPostEnabled: boolean;
  autoReview: boolean;
  rankingPrompt: string;
  shortlistPrompt: string;
  shortlistSize: number;
  updatedAt: string;
}

export type RunSummaryStatus = "running" | "completed" | "failed" | "cancelling" | "cancelled";

export interface RunSummary {
  runId: string;
  startedAt: string;
  completedAt: string | null;
  status: RunSummaryStatus;
  itemCount: number;
  reviewed: boolean;
  isDryRun: boolean;
  costBreakdown: RunCostBreakdown | null;
  issueDate?: string;
}
