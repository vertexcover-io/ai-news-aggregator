import type {
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitWebConfig,
} from "./run.js";

export interface UserSettings {
  id: string;
  profileName: string | null;
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

export type RunSummaryStatus = "running" | "completed" | "failed";

export interface RunSummary {
  runId: string;
  startedAt: string;
  completedAt: string | null;
  status: RunSummaryStatus;
  itemCount: number;
  reviewed: boolean;
}
