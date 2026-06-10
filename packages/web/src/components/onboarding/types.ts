import type { SourceType } from "@newsletter/shared";

export interface SelectedSource {
  type: SourceType;
  name: string;
  config: Record<string, unknown>;
}

export interface WizardData {
  name: string;
  slug: string;
  hasLogo: boolean;
  logoVersion: number;
  headline: string;
  topicStrip: string;
  subtagline: string;
  blurb: string;
  rankingPrompt: string;
  shortlistPrompt: string;
  notificationEmail: string;
  sources: SelectedSource[];
  pipelineTime: string;
  emailTime: string;
  scheduleTimezone: string;
}

export const STEPS = [
  { key: "name", label: "Newsletter name", req: "Required" },
  { key: "slug", label: "Subdomain", req: "Required" },
  { key: "logo", label: "Logo", req: "Optional" },
  { key: "homepage", label: "Homepage text", req: "Required" },
  { key: "prompts", label: "Prompts", req: "Required" },
  { key: "channels", label: "Social & email", req: "Optional" },
  { key: "sources", label: "Sources", req: "Required · ≥1" },
  { key: "schedule", label: "Schedule", req: "Required" },
] as const;

export const STEP_COUNT = STEPS.length;

export function emptyWizardData(): WizardData {
  return {
    name: "",
    slug: "",
    hasLogo: false,
    logoVersion: 0,
    headline: "",
    topicStrip: "",
    subtagline: "",
    blurb: "",
    rankingPrompt: "",
    shortlistPrompt: "",
    notificationEmail: "",
    sources: [],
    pipelineTime: "06:00",
    emailTime: "07:30",
    scheduleTimezone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

export function fromProgressData(data: Record<string, unknown>): WizardData {
  const base = emptyWizardData();
  return { ...base, ...(data as Partial<WizardData>) };
}
