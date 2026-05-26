import { describe, expect, it, vi } from "vitest";
import type { LanguageModel, LanguageModelUsage, ProviderMetadata } from "ai";

// Dynamic imports (`await import(...)`) of large pipeline modules occasionally
// exceed vitest's 5s default when CPU is contended (e.g. full-monorepo test:unit
// run via turbo). Raise this file's per-test timeout — wiring assertions
// themselves are fast; only the cold module load is slow.
vi.setConfig({ testTimeout: 15000 });

const STUB_USAGE: LanguageModelUsage = {
  inputTokens: 1000,
  outputTokens: 200,
  totalTokens: 1200,
  cachedInputTokens: 0,
};

const STUB_META: ProviderMetadata = {
  anthropic: {
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_creation: {
        ephemeral_5m_input_tokens: 0,
        ephemeral_1h_input_tokens: 0,
      },
    },
  },
};

const DUMMY_MODEL = {} as LanguageModel;

describe("discoverPostUrls reportUsage wiring (REQ-030, REQ-034)", () => {
  it("invokes reportUsage once with usage + providerMetadata on success", async () => {
    const { discoverPostUrls } = await import("@pipeline/collectors/web.js");
    const generateObject = vi.fn(() =>
      Promise.resolve({
        object: { posts: [] },
        usage: STUB_USAGE,
        providerMetadata: STUB_META,
      }),
    );
    // Inject by monkey-patching the imported `ai` module via dynamic mock
    vi.doMock("ai", () => ({ generateObject }));
    vi.resetModules();
    const reimported = await import("@pipeline/collectors/web.js");
    const reportUsage = vi.fn();
    await reimported.discoverPostUrls("https://x", "md", null, DUMMY_MODEL, reportUsage);
    expect(reportUsage).toHaveBeenCalledTimes(1);
    expect(reportUsage).toHaveBeenCalledWith(STUB_USAGE, STUB_META);
    vi.doUnmock("ai");
    vi.resetModules();
    void discoverPostUrls;
  });

  it("does NOT invoke reportUsage when generateObject rejects (REQ-034)", async () => {
    const generateObject = vi.fn(() => Promise.reject(new Error("boom")));
    vi.doMock("ai", () => ({ generateObject }));
    vi.resetModules();
    const { discoverPostUrls } = await import("@pipeline/collectors/web.js");
    const reportUsage = vi.fn();
    await expect(
      discoverPostUrls("https://x", "md", null, DUMMY_MODEL, reportUsage),
    ).rejects.toThrow("boom");
    expect(reportUsage).not.toHaveBeenCalled();
    vi.doUnmock("ai");
    vi.resetModules();
  });
});

describe("extractPostFields reportUsage wiring (REQ-031, REQ-034)", () => {
  it("invokes reportUsage on success", async () => {
    const generateObject = vi.fn(() =>
      Promise.resolve({
        object: { title: "t", author: "a", published_at: "", image_url: "" },
        usage: STUB_USAGE,
        providerMetadata: STUB_META,
      }),
    );
    vi.doMock("ai", () => ({ generateObject }));
    vi.resetModules();
    const { extractPostFields } = await import("@pipeline/collectors/web.js");
    const reportUsage = vi.fn();
    await extractPostFields("https://x", "md", DUMMY_MODEL, reportUsage);
    expect(reportUsage).toHaveBeenCalledTimes(1);
    vi.doUnmock("ai");
    vi.resetModules();
  });

  it("does NOT invoke reportUsage on rejection (REQ-034)", async () => {
    const generateObject = vi.fn(() => Promise.reject(new Error("nope")));
    vi.doMock("ai", () => ({ generateObject }));
    vi.resetModules();
    const { extractPostFields } = await import("@pipeline/collectors/web.js");
    const reportUsage = vi.fn();
    await expect(
      extractPostFields("https://x", "md", DUMMY_MODEL, reportUsage),
    ).rejects.toThrow("nope");
    expect(reportUsage).not.toHaveBeenCalled();
    vi.doUnmock("ai");
    vi.resetModules();
  });
});

describe("rankCandidates tracker wiring (REQ-032, REQ-034)", () => {
  it("records one rank entry on success", async () => {
    const tracker = createTrackerSpy();
    const generateObject = vi.fn(() =>
      Promise.resolve({
        object: {
          digest: {
            headline: "h",
            summary: "s",
            hook: "ho",
            twitterSummary: "tw",
          },
          ranked: [
            {
              id: 1,
              score: 0.9,
              rationale: "Signal-vs-hype solid",
              title: "Title one",
              summary: "Summary.",
              bullets: ["a", "b", "c"],
              bottomLine: "Bottom.",
            },
          ],
        },
        usage: STUB_USAGE,
        providerMetadata: STUB_META,
      }),
    );
    const { rankCandidates } = await import("@pipeline/processors/rank.js");
    const cand: import("@newsletter/shared").Candidate = {
      id: 1,
      title: "t",
      url: "https://x",
      sourceType: "hn",
      author: null,
      publishedAt: new Date(),
      engagement: { points: 0, commentCount: 0 },
      content: "body",
      comments: [],
    };
    await rankCandidates([cand], {
      topN: 1,
      generateObject,
      loadBodies: () => Promise.resolve(new Map([[1, "body"]])),
      tracker: tracker.tracker,
      modelId: "claude-haiku-4-5-20251001",
    });
    expect(tracker.records).toHaveLength(1);
    expect(tracker.records[0].stage).toBe("rank");
    expect(tracker.records[0].modelId).toBe("claude-haiku-4-5-20251001");
  });

  it("does NOT record on generate rejection (REQ-034)", async () => {
    const tracker = createTrackerSpy();
    const generateObject = vi.fn(() => Promise.reject(new Error("rank failed")));
    const { rankCandidates } = await import("@pipeline/processors/rank.js");
    const cand: import("@newsletter/shared").Candidate = {
      id: 1,
      title: "t",
      url: "https://x",
      sourceType: "hn",
      author: null,
      publishedAt: new Date(),
      engagement: { points: 0, commentCount: 0 },
      content: "body",
      comments: [],
    };
    await expect(
      rankCandidates([cand], {
        topN: 1,
        generateObject,
        loadBodies: () => Promise.resolve(new Map([[1, "body"]])),
        tracker: tracker.tracker,
        modelId: "claude-haiku-4-5-20251001",
      }),
    ).rejects.toThrow();
    expect(tracker.records).toHaveLength(0);
  });
});

describe("generateRecap tracker wiring (REQ-033, REQ-034)", () => {
  it("records one recap entry on success", async () => {
    const tracker = createTrackerSpy();
    const generateObject = vi.fn(() =>
      Promise.resolve({
        object: { title: "t", summary: "s", bullets: ["a"], bottomLine: "b" },
        usage: STUB_USAGE,
        providerMetadata: STUB_META,
      }),
    );
    const { generateRecap } = await import("@pipeline/processors/recap.js");
    await generateRecap(
      {
        id: 1,
        title: "t",
        url: "https://x",
        sourceType: "hn",
        author: null,
        publishedAt: null,
        content: "body",
      },
      {
        generateObject,
        modelId: "claude-haiku-4-5-20251001",
        tracker: tracker.tracker,
      },
    );
    expect(tracker.records).toHaveLength(1);
    expect(tracker.records[0].stage).toBe("recap");
  });

  it("does NOT record on rejection (REQ-034)", async () => {
    const tracker = createTrackerSpy();
    const generateObject = vi.fn(() => Promise.reject(new Error("recap failed")));
    const { generateRecap } = await import("@pipeline/processors/recap.js");
    await expect(
      generateRecap(
        {
          id: 1,
          title: "t",
          url: "https://x",
          sourceType: "hn",
          author: null,
          publishedAt: null,
          content: "body",
        },
        {
          generateObject,
          modelId: "claude-haiku-4-5-20251001",
          tracker: tracker.tracker,
        },
      ),
    ).rejects.toThrow();
    expect(tracker.records).toHaveLength(0);
  });
});

interface TrackerSpy {
  tracker: import("@pipeline/services/cost-tracker.js").CostTracker;
  records: { stage: string; modelId: string }[];
}

function createTrackerSpy(): TrackerSpy {
  const records: { stage: string; modelId: string }[] = [];
  return {
    records,
    tracker: {
      record(input) {
        records.push({ stage: input.stage, modelId: input.modelId });
      },
      snapshot() {
        throw new Error("not used");
      },
      merge() {
        throw new Error("not used");
      },
      hasAnyCalls() {
        return records.length > 0;
      },
    },
  };
}
