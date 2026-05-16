import { describe, it, expect } from "vitest";
import { buildRankSystemPrompt } from "@pipeline/processors/rank-prompts.js";

describe("buildRankSystemPrompt", () => {
  it("throws when the workflow is empty", () => {
    expect(() => buildRankSystemPrompt("")).toThrow(
      /requires a non-empty workflow/,
    );
  });

  it("throws when the workflow is whitespace only", () => {
    expect(() => buildRankSystemPrompt("  \n\t ")).toThrow(
      /requires a non-empty workflow/,
    );
  });

  it("places the workflow inside the editorial-workflow marker block, after the contract", () => {
    const workflow = "WORKFLOW_PROBE_TOKEN_42";
    const prompt = buildRankSystemPrompt(workflow);

    const contractEnd = prompt.indexOf("====== EDITORIAL WORKFLOW ======");
    const workflowIdx = prompt.indexOf(workflow);
    const closingMarker = prompt.lastIndexOf("======");

    expect(contractEnd).toBeGreaterThan(0);
    expect(workflowIdx).toBeGreaterThan(contractEnd);
    expect(closingMarker).toBeGreaterThan(workflowIdx);
  });

  it("trims surrounding whitespace from the workflow", () => {
    const prompt = buildRankSystemPrompt("   trimmed body   ");
    expect(prompt).toContain("\ntrimmed body\n");
    expect(prompt).not.toContain("   trimmed body");
  });
});
