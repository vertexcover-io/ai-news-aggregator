import { describe, expect, it, vi } from "vitest";
import {
  buildPromptGenerationPrompt,
  createDefaultPromptGeneration,
  createPromptGeneration,
  PromptGenerationError,
} from "@api/services/prompt-generation.js";
import {
  DEFAULT_RANKING_PROMPT,
  DEFAULT_SHORTLIST_PROMPT,
} from "@newsletter/shared";

describe("createPromptGeneration", () => {
  it("feeds the description plus both default prompts to the llm as reference (REQ-036)", async () => {
    const llm = vi.fn((_prompt: string) =>
      Promise.resolve({ rankingPrompt: "r", shortlistPrompt: "pick {{N}}" }),
    );
    const service = createPromptGeneration(llm);
    await service.generate("LLM inference for prod engineers.");
    const prompt = llm.mock.calls[0][0];
    expect(prompt).toContain("LLM inference for prod engineers.");
    expect(prompt).toContain(DEFAULT_RANKING_PROMPT);
    expect(prompt).toContain(DEFAULT_SHORTLIST_PROMPT);
  });

  it("returns validated prompt candidates", async () => {
    const service = createPromptGeneration(() =>
      Promise.resolve({
        rankingPrompt: "rank me",
        shortlistPrompt: "pick the top {{N}} items",
      }),
    );
    await expect(service.generate("a fine description")).resolves.toEqual({
      rankingPrompt: "rank me",
      shortlistPrompt: "pick the top {{N}} items",
    });
  });

  it("wraps malformed llm output in PromptGenerationError", async () => {
    const service = createPromptGeneration(() =>
      Promise.resolve({ rankingPrompt: "only one half" }),
    );
    await expect(service.generate("desc")).rejects.toBeInstanceOf(
      PromptGenerationError,
    );
  });

  it("wraps llm transport failures in PromptGenerationError", async () => {
    const service = createPromptGeneration(() =>
      Promise.reject(new Error("api blew up")),
    );
    await expect(service.generate("desc")).rejects.toBeInstanceOf(
      PromptGenerationError,
    );
  });
});

describe("createDefaultPromptGeneration", () => {
  it("is null without an ANTHROPIC_API_KEY (route answers 503)", () => {
    expect(createDefaultPromptGeneration({})).toBeNull();
    expect(
      createDefaultPromptGeneration({ ANTHROPIC_API_KEY: "  " }),
    ).toBeNull();
  });

  it("is enabled when a key is present", () => {
    expect(
      createDefaultPromptGeneration({ ANTHROPIC_API_KEY: "sk-ant-test" }),
    ).not.toBeNull();
  });
});

describe("buildPromptGenerationPrompt", () => {
  it("instructs the model to preserve the {{N}} placeholder", () => {
    expect(buildPromptGenerationPrompt("desc")).toContain("{{N}}");
  });
});
