/**
 * EDGE-010 / REQ-054: Golden-set regression test for source-neutrality.
 *
 * Two near-identical candidates (same title, body, publishedAt) differing
 * only by sourceType and comment availability
 * (blog with comments: [] vs HN with 5 comments) must receive scores within
 * ±5 points of each other.
 *
 * The mock LLM inspects the REAL assembled prompt that `rankCandidates`
 * passes, verifies the verbatim source-neutrality rule is present, then
 * scores each item from a heuristic that depends ONLY on body-driven signal
 * (not comments). If a future prompt edit leaks comment-presence bias into
 * the prompt in a way that the heuristic picks up, the test fires.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import type {
  Candidate,
  RawItemComment,
} from "@newsletter/shared";
import { rankCandidates } from "@pipeline/processors/rank.js";
import { SOURCE_NEUTRALITY_RULE } from "@pipeline/processors/rank-prompts.js";

interface GenerateArgs {
  model: unknown;
  system: string;
  prompt: string;
  schema: z.ZodType;
  temperature?: number;
}

interface PromptPayload {
  items: {
    id: number;
    title: string;
    sourceType: string;
    body: string | null;
    comments?: string[];
  }[];
}

const SHARED_TITLE = "A deep dive into agent frameworks and LLM infrastructure";
const SHARED_BODY =
  "This article explores how modern agent frameworks coordinate tool use, " +
  "planning, and memory across LLM inference pipelines. It covers concrete " +
  "trade-offs in latency, cost, and correctness, with practical benchmarks.";
const SHARED_PUBLISHED = new Date("2026-04-07T00:00:00Z");

function makeComment(id: string, content: string): RawItemComment {
  return {
    id,
    author: "anon",
    content,
    publishedAt: "2026-04-07T00:30:00Z",
  };
}

function makeBlog(): Candidate {
  return {
    id: 1,
    title: SHARED_TITLE,
    url: "https://blog.example.com/agents-and-llm-infra",
    sourceType: "blog",
    author: "writer",
    publishedAt: SHARED_PUBLISHED,
    engagement: { points: 0, commentCount: 0 },
    content: SHARED_BODY,
    comments: [],
  };
}

function makeHn(): Candidate {
  return {
    id: 2,
    title: SHARED_TITLE,
    url: "https://blog.example.com/agents-and-llm-infra",
    sourceType: "hn",
    author: "poster",
    publishedAt: SHARED_PUBLISHED,
    engagement: { points: 120, commentCount: 5 },
    content: SHARED_BODY,
    comments: [
      makeComment("c1", "Interesting take on tool-use coordination."),
      makeComment("c2", "The latency benchmarks are what I wanted to see."),
      makeComment("c3", "Curious how this compares to other frameworks."),
      makeComment("c4", "Correctness trade-offs are often overlooked."),
      makeComment("c5", "Good practical notes on memory models."),
    ],
  };
}

describe("source-neutrality golden-set (EDGE-010, REQ-054)", () => {
  it("blog vs HN with comparable bodies score within ±5 points", async () => {
    const stubLoadBodies = (
      cs: Candidate[],
    ): Promise<Map<number, string | null>> => {
      const m = new Map<number, string | null>();
      for (const c of cs) m.set(c.id, c.content);
      return Promise.resolve(m);
    };

    const generateObject = (
      args: GenerateArgs,
    ): Promise<{
      object: {
        digest: {
          headline: string;
          summary: string;
          hook: string;
          twitterSummary: string;
        };
        ranked: { id: number; score: number; rationale: string }[];
      };
    }> => {
      // Assert the source-neutrality rule is present verbatim in the prompt
      // the ranker actually composes. If a future edit drops or rewords it,
      // this test fires.
      expect(args.system).toContain(SOURCE_NEUTRALITY_RULE);

      const payload = JSON.parse(args.prompt) as PromptPayload;

      // Heuristic: body length * 0.1. DOES NOT read comments.
      // Two items with identical bodies get identical scores.
      const scoreForItem = (item: PromptPayload["items"][number]): number => {
        return (item.body?.length ?? 0) * 0.1;
      };

      return Promise.resolve({
        object: {
          digest: {
            headline: "Source neutrality test digest",
            summary: "Stub digest summary used by source-neutrality test fixture.",
            hook: "Stub social hook.",
            twitterSummary: "Stub Twitter summary.",
          },
          ranked: payload.items.map((it) => ({
            id: it.id,
            score: scoreForItem(it),
            rationale:
              "strong Agentic-systems-relevance — practical agent framework research",
            summary: "Test summary for this item.",
            bullets: ["First point.", "Second point.", "Third point."],
            bottomLine: "Strategic takeaway.",
          })),
        },
      });
    };

    const result = await rankCandidates([makeBlog(), makeHn()], {
      topN: 5,
      halfLifeHours: 48,
      now: SHARED_PUBLISHED, // age 0 so recency multiplier is 1
      generateObject,
      loadBodies: stubLoadBodies,
    });

    expect(result.rankedItems).toHaveLength(2);
    const blogScore = result.rankedItems.find((r) => r.rawItemId === 1)?.score;
    const hnScore = result.rankedItems.find((r) => r.rawItemId === 2)?.score;
    expect(blogScore).toBeDefined();
    expect(hnScore).toBeDefined();
    expect(Math.abs((blogScore ?? 0) - (hnScore ?? 0))).toBeLessThanOrEqual(5);
  });
});
