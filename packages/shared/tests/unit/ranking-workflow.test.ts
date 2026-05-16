import { describe, it, expect } from "vitest";
import {
  DEFAULT_RANKING_WORKFLOW,
  resolveRankingWorkflow,
} from "@newsletter/shared";

describe("resolveRankingWorkflow", () => {
  it("returns the default when the input is empty", () => {
    expect(resolveRankingWorkflow("")).toBe(DEFAULT_RANKING_WORKFLOW);
  });

  it("returns the default when the input is whitespace only", () => {
    expect(resolveRankingWorkflow("  \n\t ")).toBe(DEFAULT_RANKING_WORKFLOW);
  });

  it("returns the trimmed input when non-empty", () => {
    expect(resolveRankingWorkflow(" boost agent stuff ")).toBe(
      "boost agent stuff",
    );
  });
});
