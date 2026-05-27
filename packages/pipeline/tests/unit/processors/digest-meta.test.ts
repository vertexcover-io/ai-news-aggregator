import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { DIGEST_META_INSTRUCTIONS, digestSchema } from "@newsletter/shared/constants";

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
  generateDigestMeta,
  type DigestMetaInputItem,
} from "@pipeline/processors/digest-meta.js";
import { TWITTER_SUMMARY_MAX_CHARS as RAW_MAX } from "@pipeline/processors/rank.js";

const TWITTER_SUMMARY_MAX_CHARS: number = RAW_MAX;

interface GenerateArgs {
  model: unknown;
  system: string;
  prompt: string;
  schema: z.ZodType;
  temperature?: number;
  maxRetries?: number;
}

function validDigest(): {
  headline: string;
  summary: string;
  hook: string;
  twitterSummary: string;
} {
  return {
    headline: "OpenAI ships GPT-5 with native tool use",
    summary: "Plus: Anthropic raises $5B and ARC-AGI-3 exposes reasoning gaps.",
    hook: "The AI stack just shifted under everyone's feet.",
    twitterSummary: "OpenAI shipped GPT-5 with native tool use and a 400K context window today.",
  };
}

function items(): DigestMetaInputItem[] {
  return [
    {
      rank: 1,
      title: "OpenAI ships GPT-5",
      summary: "OpenAI released GPT-5 today.",
      bottomLine: "Buyers must reassess defaults.",
    },
    {
      rank: 2,
      title: "Anthropic raises $5B",
      summary: "Anthropic closed a $5B round.",
      bottomLine: "The valuation race tightens.",
    },
  ];
}

describe("generateDigestMeta", () => {
  it("REQ-002: returns the digest fields from one generateObject call using digestSchema + DIGEST_META_INSTRUCTIONS", async () => {
    const digest = validDigest();
    const generate = vi.fn((_args: GenerateArgs) => Promise.resolve({ object: digest }));

    const result = await generateDigestMeta(items(), { generateObject: generate });

    expect(result).toEqual(digest);
    expect(generate).toHaveBeenCalledOnce();
    const call = generate.mock.calls[0]?.[0];
    expect(call?.schema).toBe(digestSchema);
    expect(call?.system).toBe(DIGEST_META_INSTRUCTIONS);
    expect(call?.temperature).toBe(0);
    expect(call?.maxRetries).toBe(2);
  });

  it("REQ-002: forwards the ordered item list and twitterSummaryMaxChars in the prompt", async () => {
    const digest = validDigest();
    const generate = vi.fn((_args: GenerateArgs) => Promise.resolve({ object: digest }));

    await generateDigestMeta(items(), { generateObject: generate });

    const call = generate.mock.calls[0]?.[0];
    expect(call?.prompt).toContain("OpenAI ships GPT-5");
    expect(call?.prompt).toContain("Anthropic raises $5B");
    expect(call?.prompt).toContain(String(TWITTER_SUMMARY_MAX_CHARS));
  });

  it("REQ-003 / EDGE-008: retries exactly once when twitterSummary is over budget, returns the shorter retry value", async () => {
    const overBudget = {
      ...validDigest(),
      twitterSummary: "x".repeat(TWITTER_SUMMARY_MAX_CHARS + 50),
    };
    const valid = validDigest();
    const generate = vi
      .fn<(args: GenerateArgs) => Promise<{ object: unknown }>>()
      .mockResolvedValueOnce({ object: overBudget })
      .mockResolvedValueOnce({ object: valid });

    const result = await generateDigestMeta(items(), { generateObject: generate });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.twitterSummary.length).toBeLessThanOrEqual(TWITTER_SUMMARY_MAX_CHARS);
    expect(result.twitterSummary).toBe(valid.twitterSummary);
    const retryCall = generate.mock.calls[1]?.[0];
    expect(retryCall?.prompt).toContain("exceeded twitterSummaryMaxChars");
  });

  it("EDGE-008: stops after one retry even when still over budget (no third call)", async () => {
    const overBudget = {
      ...validDigest(),
      twitterSummary: "y".repeat(TWITTER_SUMMARY_MAX_CHARS + 10),
    };
    const generate = vi.fn((_args: GenerateArgs) => Promise.resolve({ object: overBudget }));

    const result = await generateDigestMeta(items(), { generateObject: generate });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.twitterSummary.length).toBeGreaterThan(TWITTER_SUMMARY_MAX_CHARS);
  });

  it("REQ-004 / EDGE-001: throws on an empty item list without calling the LLM", async () => {
    const generate = vi.fn((_args: GenerateArgs) => Promise.resolve({ object: validDigest() }));

    await expect(generateDigestMeta([], { generateObject: generate })).rejects.toThrow(
      /empty item list/,
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it("records a 'digest' cost-tracker stage when a tracker is supplied", async () => {
    const digest = validDigest();
    const generate = vi.fn((_args: GenerateArgs) =>
      Promise.resolve({ object: digest, usage: { inputTokens: 1, outputTokens: 2 } }),
    );
    const record = vi.fn();
    const tracker = {
      record,
      snapshot: vi.fn(),
      merge: vi.fn(),
      hasAnyCalls: vi.fn(() => true),
    };

    await generateDigestMeta(items(), { generateObject: generate, tracker });

    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0]?.stage).toBe("digest");
  });
});
