import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { Candidate } from "@newsletter/shared";
import type { CostTracker } from "@pipeline/services/cost-tracker.js";

const { mockLoggerInfo, mockLoggerWarn, mockLoggerDebug, mockLoggerError } =
  vi.hoisted(() => ({
    mockLoggerInfo: vi.fn(),
    mockLoggerWarn: vi.fn(),
    mockLoggerDebug: vi.fn(),
    mockLoggerError: vi.fn(),
  }));

vi.mock("@newsletter/shared", async () => {
  const actual =
    await vi.importActual<typeof import("@newsletter/shared")>(
      "@newsletter/shared",
    );
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      info: mockLoggerInfo,
      warn: mockLoggerWarn,
      debug: mockLoggerDebug,
      error: mockLoggerError,
    })),
  };
});

import {
  shortlistCandidates,
  DEFAULT_SHORTLIST_MODEL,
} from "@pipeline/processors/shortlist.js";

const NOW = new Date("2026-04-09T12:00:00Z");
const TEST_PROMPT = "TEST SHORTLIST PROMPT — pick the top items.";

function makeCandidate(id: number, overrides: Partial<Candidate> = {}): Candidate {
  return {
    id,
    title: `Item ${id}`,
    url: `https://example.com/${id}`,
    sourceType: "hn",
    author: null,
    publishedAt: new Date(NOW.getTime() - 24 * 3_600_000),
    engagement: { points: 0, commentCount: 0 },
    content: null,
    comments: [],
    ...overrides,
  };
}

interface GenerateArgs {
  model: unknown;
  system: string;
  prompt: string;
  schema: z.ZodType;
  temperature?: number;
  abortSignal?: AbortSignal;
}

function makeGenerate(
  response: { ids: string[] } | Error,
  opts: {
    usage?: unknown;
    providerMetadata?: unknown;
    captureModel?: { current?: unknown };
  } = {},
): ReturnType<typeof vi.fn> {
  return vi.fn((args: GenerateArgs) => {
    if (opts.captureModel) opts.captureModel.current = args.model;
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve({
      object: response,
      usage: opts.usage ?? {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
      providerMetadata: opts.providerMetadata,
    });
  });
}

function makeTracker(): CostTracker & { recordMock: ReturnType<typeof vi.fn> } {
  const recordMock = vi.fn();
  return {
    record: recordMock,
    snapshot: vi.fn(),
    merge: vi.fn(),
    hasAnyCalls: vi.fn(() => false),
    recordMock,
  } as unknown as CostTracker & { recordMock: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  mockLoggerInfo.mockReset();
  mockLoggerWarn.mockReset();
  mockLoggerDebug.mockReset();
  mockLoggerError.mockReset();
});

describe("shortlistCandidates (LLM-based)", () => {
  const originalModel = process.env.SHORTLIST_MODEL;

  beforeEach(() => {
    delete process.env.SHORTLIST_MODEL;
  });

  afterEach(() => {
    if (originalModel === undefined) delete process.env.SHORTLIST_MODEL;
    else process.env.SHORTLIST_MODEL = originalModel;
  });

  it("returns 30 of 50 candidates in LLM-returned order (REQ-001)", async () => {
    const candidates = Array.from({ length: 50 }, (_, i) =>
      makeCandidate(i + 1),
    );
    // Reverse-ish order: pick odd-indexed ids first
    const pickedIds = Array.from({ length: 30 }, (_, i) =>
      String(50 - i),
    );
    const generate = makeGenerate({ ids: pickedIds });

    const result = await shortlistCandidates(candidates, {
      shortlistSize: 30,
      systemPrompt: TEST_PROMPT,
      runId: "run-1",
      generate,
    });

    expect(result.shortlist).toHaveLength(30);
    expect(result.shortlist.map((c) => String(c.id))).toEqual(pickedIds);
    expect(result.breakdowns).toEqual([]);
  });

  it("drops ids not present in the input set (REQ-002)", async () => {
    const candidates = [makeCandidate(1), makeCandidate(2), makeCandidate(3)];
    const generate = makeGenerate({
      ids: ["1", "bogus-id", "3"],
    });

    const result = await shortlistCandidates(candidates, {
      shortlistSize: 10,
      systemPrompt: TEST_PROMPT,
      runId: "run-1",
      generate,
    });

    expect(result.shortlist.map((c) => c.id)).toEqual([1, 3]);
    expect(mockLoggerWarn).toHaveBeenCalled();
    const warnEvents = mockLoggerWarn.mock.calls.map((args) => args[0]);
    expect(
      warnEvents.some(
        (e) => e && typeof e === "object" && e.event === "shortlist.unknown_id",
      ),
    ).toBe(true);
  });

  it("returns fewer than N when LLM returns fewer (REQ-003)", async () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      makeCandidate(i + 1),
    );
    const generate = makeGenerate({ ids: ["1", "2", "3", "4", "5"] });

    const result = await shortlistCandidates(candidates, {
      shortlistSize: 30,
      systemPrompt: TEST_PROMPT,
      runId: "run-1",
      generate,
    });

    expect(result.shortlist).toHaveLength(5);
  });

  it("returns empty shortlist when LLM returns 0 ids (REQ-004)", async () => {
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const generate = makeGenerate({ ids: [] });

    const result = await shortlistCandidates(candidates, {
      shortlistSize: 30,
      systemPrompt: TEST_PROMPT,
      runId: "run-1",
      generate,
    });

    expect(result).toEqual({ shortlist: [], breakdowns: [] });
  });

  it("rethrows LLM errors (REQ-005)", async () => {
    const candidates = [makeCandidate(1)];
    const tracker = makeTracker();
    const generate = makeGenerate(new Error("anthropic blew up"));

    await expect(
      shortlistCandidates(candidates, {
        shortlistSize: 30,
        systemPrompt: TEST_PROMPT,
        runId: "run-1",
        generate,
        tracker,
      }),
    ).rejects.toThrow("anthropic blew up");

    expect(tracker.recordMock).not.toHaveBeenCalled();
  });

  it("calls tracker.record once with stage=shortlist on success (REQ-006)", async () => {
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const tracker = makeTracker();
    const usage = { inputTokens: 222, outputTokens: 11, totalTokens: 233 };
    const providerMetadata = { anthropic: { cacheReadInputTokens: 0 } };
    const generate = makeGenerate(
      { ids: ["1"] },
      { usage, providerMetadata },
    );

    await shortlistCandidates(candidates, {
      shortlistSize: 30,
      systemPrompt: TEST_PROMPT,
      runId: "run-1",
      generate,
      tracker,
    });

    expect(tracker.recordMock).toHaveBeenCalledTimes(1);
    expect(tracker.recordMock).toHaveBeenCalledWith({
      stage: "shortlist",
      modelId: DEFAULT_SHORTLIST_MODEL,
      usage,
      providerMetadata,
    });
  });

  it("does not call tracker.record on LLM error (REQ-006)", async () => {
    const candidates = [makeCandidate(1)];
    const tracker = makeTracker();
    const generate = makeGenerate(new Error("boom"));

    await expect(
      shortlistCandidates(candidates, {
        shortlistSize: 10,
        systemPrompt: TEST_PROMPT,
        runId: "run-1",
        generate,
        tracker,
      }),
    ).rejects.toThrow();

    expect(tracker.recordMock).not.toHaveBeenCalled();
  });

  it("respects SHORTLIST_MODEL env override (REQ-007)", async () => {
    process.env.SHORTLIST_MODEL = "claude-haiku-test-env-model";
    const candidates = [makeCandidate(1)];
    const tracker = makeTracker();
    const generate = makeGenerate({ ids: ["1"] });

    await shortlistCandidates(candidates, {
      shortlistSize: 10,
      systemPrompt: TEST_PROMPT,
      runId: "run-1",
      generate,
      tracker,
    });

    expect(tracker.recordMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "claude-haiku-test-env-model" }),
    );
  });

  it("options.modelId overrides env (REQ-007)", async () => {
    process.env.SHORTLIST_MODEL = "from-env";
    const candidates = [makeCandidate(1)];
    const tracker = makeTracker();
    const generate = makeGenerate({ ids: ["1"] });

    await shortlistCandidates(candidates, {
      shortlistSize: 10,
      systemPrompt: TEST_PROMPT,
      runId: "run-1",
      modelId: "from-options",
      generate,
      tracker,
    });

    expect(tracker.recordMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "from-options" }),
    );
  });

  it("passes systemPrompt verbatim and includes shortlistSize in payload (REQ-001, REQ-008)", async () => {
    const candidates = [
      makeCandidate(1, { title: "First post" }),
      makeCandidate(2, { title: "Second post" }),
    ];
    const generate = makeGenerate({ ids: ["1"] });

    await shortlistCandidates(candidates, {
      shortlistSize: 17,
      systemPrompt: TEST_PROMPT,
      runId: "run-1",
      generate,
    });

    const call = generate.mock.calls[0]?.[0] as GenerateArgs;
    expect(call.system).toBe(TEST_PROMPT);
    expect(call.temperature).toBe(0);
    expect(call.prompt).toContain('"shortlistSize": 17');
    expect(call.prompt).toContain("First post");
    expect(call.prompt).toContain("Second post");
    expect(call.prompt).toContain('"id": "1"');
  });

  it("returns empty result without invoking generate when candidates is empty", async () => {
    const generate = vi.fn();

    const result = await shortlistCandidates([], {
      shortlistSize: 30,
      systemPrompt: TEST_PROMPT,
      runId: "run-1",
      generate,
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result).toEqual({ shortlist: [], breakdowns: [] });
  });
});
