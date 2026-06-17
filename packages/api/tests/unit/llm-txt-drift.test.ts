import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createLlmTxtRouter } from "@api/routes/llm-txt.js";
import { buildLlmTxtSnapshot } from "@api/services/llm-txt-snapshot.js";
import type { IssueFull } from "@newsletter/shared/llm-txt";
import type { PublicMustReadEntry } from "@newsletter/shared";
import type {
  RunArchivesRepo,
  RunArchiveRow,
} from "@api/repositories/run-archives.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type {
  MustReadRepo,
  MustReadPublicEntry,
} from "@api/repositories/must-read.js";

const baseUrl = "https://news.example.com";

const completedAt = new Date("2026-06-17T10:00:00Z");

function makeRow(): RunArchiveRow {
  return {
    id: "run-1",
    status: "completed",
    rankedItems: [{ rawItemId: 1, score: 0.9, rationale: "r" }],
    topN: 5,
    reviewed: true,
    isDryRun: false,
    completedAt,
    publishedAt: completedAt,
    draftSavedAt: null,
    createdAt: completedAt,
    startedAt: null,
    sourceTypes: null,
    digestHeadline: "Headline",
    digestSummary: "Summary",
    hook: null,
    twitterSummary: null,
    linkedinPostBody: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    emailSentAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    notificationState: null,
    costBreakdown: null,
    runFunnel: null,
    socialMetadata: null,
    shortlistedItemIds: null,
    preReviewSnapshot: null,
  };
}

const canonRows: MustReadPublicEntry[] = [
  {
    id: "c1",
    url: "https://essay.example/a",
    title: "Essay A",
    author: "Auth",
    year: 2020,
    annotation: "Read it.",
    addedAt: new Date("2026-01-01T00:00:00Z"),
  } as MustReadPublicEntry,
];

const canonWire: PublicMustReadEntry[] = [
  {
    id: "c1",
    url: "https://essay.example/a",
    title: "Essay A",
    author: "Auth",
    year: 2020,
    annotation: "Read it.",
    addedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
  },
];

function makeArchiveRepo(rows: RunArchiveRow[]): RunArchivesRepo {
  return {
    list: vi.fn(() => Promise.resolve(rows)),
    listReviewedRows: vi.fn(() =>
      Promise.resolve(rows.filter((r) => r.reviewed && !r.isDryRun)),
    ),
    findById: vi.fn(() => Promise.resolve(rows[0] ?? null)),
    listReviewed: vi.fn(() => Promise.resolve([])),
  } as unknown as RunArchivesRepo;
}

function makeRawRepo(): RawItemsRepo {
  return {
    findByIds: vi.fn(() =>
      Promise.resolve([
        {
          id: 1,
          sourceType: "hn",
          title: "Story One",
          url: "https://example.com/1",
          sourceUrl: null,
          author: null,
          publishedAt: null,
          engagement: { points: 0, commentCount: 0 },
          content: null,
          imageUrl: null,
          metadata: {
            comments: [],
            recap: {
              title: "Story One",
              summary: "It happened.",
              bullets: ["b"],
              bottomLine: "BL",
            },
          },
        },
      ]),
    ),
  } as unknown as RawItemsRepo;
}

function makeMustReadRepo(): MustReadRepo {
  return {
    listPublic: vi.fn(() => Promise.resolve(canonRows)),
  } as unknown as MustReadRepo;
}

describe("llm.txt no-drift", () => {
  it("GET /llms.txt body equals buildLlmTxtSnapshot().index for the same data", async () => {
    const app = new Hono();
    app.route(
      "/",
      createLlmTxtRouter({
        getArchiveRepo: () => makeArchiveRepo([makeRow()]),
        getRawItemsRepo: () => makeRawRepo(),
        getMustReadRepo: () => makeMustReadRepo(),
        baseUrl,
      }),
    );
    const routeBody = await (await app.request("/llms.txt")).text();

    const issues: IssueFull[] = [
      {
        meta: {
          runId: "run-1",
          issueDate: "2026-06-17",
          digestHeadline: "Headline",
          digestSummary: "Summary",
        },
        stories: [
          {
            title: "Story One",
            url: "https://example.com/1",
            recap: {
              title: "Story One",
              summary: "It happened.",
              bullets: ["b"],
              bottomLine: "BL",
            },
          },
        ],
      },
    ];
    const snapshot = buildLlmTxtSnapshot({ baseUrl, issues, canon: canonWire });

    expect(routeBody).toBe(snapshot.index);
  });
});
