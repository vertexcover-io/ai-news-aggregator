import type {
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitTwitterConfig,
  RunSubmitWebConfig,
} from "./run.js";

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
  posthogEnabled: boolean;
  posthogProjectToken: string | null;
  posthogHost: string | null;
  scheduleTime: string;
  scheduleTimezone: string;
  scheduleEnabled: boolean;
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
}
