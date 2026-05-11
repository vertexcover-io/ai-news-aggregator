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

import { generateRecap, recapContentSchema } from "@pipeline/processors/recap.js";
import type { RecapInputItem } from "@pipeline/processors/recap.js";

interface GenerateArgs {
  model: unknown;
  system: string;
  prompt: string;
  schema: z.ZodType;
  temperature?: number;
}

function validRecap(): {
  summary: string;
  bullets: string[];
  bottomLine: string;
} {
  return {
    summary: "This is a meaningful summary of the item.",
    bullets: [
      "First analysis point explaining significance.",
      "Second analysis point about broader impact.",
      "Third analysis point on practical implications.",
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

  it("uses the provided model id when specified", async () => {
    const recap = validRecap();
    const generate = vi.fn((_args: GenerateArgs) => Promise.resolve({ object: recap }));
    await generateRecap(makeItem(), {
      generateObject: generate,
      modelId: "claude-haiku-custom",
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("uses RANKING_MODEL env var as model id when modelId option is not set", async () => {
    const recap = validRecap();
    const generate = vi.fn((_args: GenerateArgs) => Promise.resolve({ object: recap }));
    const savedEnv = process.env.RANKING_MODEL;
    process.env.RANKING_MODEL = "claude-opus-test";
    try {
      await generateRecap(makeItem(), { generateObject: generate });
    } finally {
      if (savedEnv === undefined) {
        delete process.env.RANKING_MODEL;
      } else {
        process.env.RANKING_MODEL = savedEnv;
      }
    }
    expect(generate).toHaveBeenCalledOnce();
  });

  it("serializes null publishedAt as null in the prompt", async () => {
    const recap = validRecap();
    const generate = vi.fn((_args: GenerateArgs) => Promise.resolve({ object: recap }));
    await generateRecap(makeItem({ publishedAt: null }), { generateObject: generate });
    const call = generate.mock.calls[0]?.[0];
    const payload = JSON.parse(call?.prompt ?? "{}") as { item: { publishedAt: unknown } };
    expect(payload.item.publishedAt).toBeNull();
  });

});
