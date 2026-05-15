import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: (): {
    info: () => undefined;
    warn: () => undefined;
    error: () => undefined;
    debug: () => undefined;
  } => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

import {
  generateRecap,
  recapContentSchema,
  RECAP_SYSTEM_PROMPT,
} from "@pipeline/processors/recap.js";
import type { RecapInputItem } from "@pipeline/processors/recap.js";

interface GenerateArgs {
  model: unknown;
  system: string;
  prompt: string;
  schema: z.ZodType;
  temperature?: number;
}

function validRecap(): {
  title: string;
  summary: string;
  bullets: string[];
  bottomLine: string;
} {
  return {
    title: "Test recap title",
    summary: "This is a meaningful summary of the item.",
    bullets: [
      "First concrete detail with a specific product change.",
      "Second concrete detail with a relevant number.",
      "Third concrete detail with an important caveat.",
    ],
    bottomLine: "This is the strategic takeaway for readers.",
  };
}

function makeItem(overrides: Partial<RecapInputItem> = {}): RecapInputItem {
  return {
    id: 1,
    title: "Test Title",
    url: "https://example.com/x",
    sourceType: "hn",
    author: "alice",
    publishedAt: new Date("2026-04-13T00:00:00Z"),
    content: "Full body content to summarize.",
    ...overrides,
  };
}

describe("generateRecap", () => {
  it("returns a valid RecapContent for a well-formed provider response", async () => {
    const recap = validRecap();
    const generate = vi.fn((_args: GenerateArgs) => Promise.resolve({ object: recap }));
    const result = await generateRecap(makeItem(), { generateObject: generate });
    expect(result).toEqual(recap);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("forwards item content to the prompt", async () => {
    const recap = validRecap();
    const generate = vi.fn((_args: GenerateArgs) => Promise.resolve({ object: recap }));
    await generateRecap(
      makeItem({ title: "My Unique Title", content: "Unique body marker ABC123" }),
      { generateObject: generate },
    );
    const call = generate.mock.calls[0]?.[0];
    expect(call?.prompt).toContain("My Unique Title");
    expect(call?.prompt).toContain("Unique body marker ABC123");
  });

  it("propagates provider failures", async () => {
    const generate = vi.fn((_args: GenerateArgs) =>
      Promise.reject(new Error("provider down")),
    );
    await expect(generateRecap(makeItem(), { generateObject: generate })).rejects.toThrow(
      /provider down/,
    );
  });

  it("rejects responses with wrong types", () => {
    const parseResult = recapContentSchema.safeParse({
      summary: "ok",
      bullets: "not an array",
      bottomLine: "ok",
    });
    expect(parseResult.success).toBe(false);
  });

  it("requires a non-empty title in the structured output", () => {
    const missing = recapContentSchema.safeParse({
      summary: "ok",
      bullets: ["a"],
      bottomLine: "ok",
    });
    expect(missing.success).toBe(false);
    const empty = recapContentSchema.safeParse({
      title: "",
      summary: "ok",
      bullets: ["a"],
      bottomLine: "ok",
    });
    expect(empty.success).toBe(false);
    const valid = recapContentSchema.safeParse({
      title: "OpenAI ships GPT-5",
      summary: "ok",
      bullets: ["a"],
      bottomLine: "ok",
    });
    expect(valid.success).toBe(true);
  });

  it("uses the provided model id when specified", async () => {
    const recap = validRecap();
    const generate = vi.fn((_args: GenerateArgs) => Promise.resolve({ object: recap }));
    await generateRecap(makeItem(), {
      generateObject: generate,
      modelId: "claude-haiku-custom",
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("defines summary, bullets, and bottomLine as non-overlapping editorial layers", () => {
    expect(RECAP_SYSTEM_PROMPT).toContain("summary = ORIENT");
    expect(RECAP_SYSTEM_PROMPT).toContain("bullets = EXPLAIN");
    expect(RECAP_SYSTEM_PROMPT).toContain("bottomLine = INTERPRET");
    expect(RECAP_SYSTEM_PROMPT).toContain("Exactly 3");
    expect(RECAP_SYSTEM_PROMPT).toContain(
      "Each bullet must add new information not already stated in the summary",
    );
    expect(RECAP_SYSTEM_PROMPT).not.toContain(
      "3-5 plain-text analysis points explaining why this matters",
    );
  });
});
