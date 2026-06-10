import type { WizardData } from "./types";

export interface MissingRequirement {
  step: number;
  label: string;
}

export function missingRequirements(data: WizardData): MissingRequirement[] {
  const missing: MissingRequirement[] = [];
  if (!data.name.trim()) missing.push({ step: 0, label: "Newsletter name" });
  if (!data.slug.trim()) missing.push({ step: 1, label: "Subdomain" });
  if (!data.headline.trim()) missing.push({ step: 3, label: "Headline" });
  if (!data.rankingPrompt.trim() || !data.shortlistPrompt.trim())
    missing.push({ step: 4, label: "Prompts" });
  if (data.sources.length === 0)
    missing.push({ step: 6, label: "At least one source" });
  if (!data.pipelineTime.trim() || !data.emailTime.trim())
    missing.push({ step: 7, label: "Schedule" });
  return missing;
}

export function canActivate(data: WizardData): boolean {
  return missingRequirements(data).length === 0;
}
