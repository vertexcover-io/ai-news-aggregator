import { describe, expect, it } from "vitest";
import {
  canActivate,
  missingRequirements,
} from "@/components/onboarding/activation";
import { emptyWizardData, type WizardData } from "@/components/onboarding/types";

function complete(): WizardData {
  return {
    ...emptyWizardData(),
    name: "The Inference",
    slug: "theinference",
    headline: "The daily read",
    rankingPrompt: "rank",
    shortlistPrompt: "shortlist",
    sources: [{ type: "reddit", name: "r/LocalLLaMA", config: {} }],
    pipelineTime: "06:00",
    emailTime: "07:30",
  };
}

describe("onboarding activation gating", () => {
  it("allows activation when all required steps are filled", () => {
    expect(canActivate(complete())).toBe(true);
    expect(missingRequirements(complete())).toHaveLength(0);
  });

  it("blocks activation with an empty wizard and lists every requirement", () => {
    const data = emptyWizardData();
    expect(canActivate(data)).toBe(false);
    const labels = missingRequirements(data).map((m) => m.label);
    expect(labels).toContain("Newsletter name");
    expect(labels).toContain("Subdomain");
    expect(labels).toContain("Headline");
    expect(labels).toContain("Prompts");
    expect(labels).toContain("At least one source");
  });

  it("blocks when sources are empty even if everything else is set", () => {
    const data = { ...complete(), sources: [] };
    expect(canActivate(data)).toBe(false);
    expect(missingRequirements(data).map((m) => m.label)).toEqual([
      "At least one source",
    ]);
  });

  it("blocks when prompts are missing", () => {
    const data = { ...complete(), rankingPrompt: "", shortlistPrompt: "" };
    expect(canActivate(data)).toBe(false);
    expect(missingRequirements(data).map((m) => m.label)).toContain("Prompts");
  });
});
