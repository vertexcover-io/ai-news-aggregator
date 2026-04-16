import type {
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitWebConfig,
} from "./run.js";

export interface UserSettings {
  id: string;
  topN: number;
  halfLifeHours: number | null;
  hnConfig: RunSubmitHnConfig | null;
  redditConfig: RunSubmitRedditConfig | null;
  webConfig: RunSubmitWebConfig | null;
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
