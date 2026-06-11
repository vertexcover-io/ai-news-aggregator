import { describe, it, expect } from "vitest";
import type { RawItemRow } from "@pipeline/repositories/raw-items.js";
import { ENRICHED_SUMMARY_LAUNCHED_AT } from "@newsletter/shared/constants";

// Import the function under test via the module's public export path.
// hydrateItems is not exported directly; we test it via the exported
// NewsletterStory shape by calling the full handleEmailSendJob flow would be
// too heavy. Instead, extract behaviour through a narrow seam: we exercise the
// worker's hydrateItems by constructing a minimal archive + rawItemsRepo stub
// and checking what renderNewsletter is called with.

import { vi } from "vitest";
import type { EmailSendDeps } from "@pipeline/workers/email-send.js";
import type { PipelineRunArchiveRow } from "@pipeline/repositories/run-archives.js";

const { handleEmailSendJob } = await import("@pipeline/workers/email-send.js");

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

function makeSendPacer() {
  return { acquire: vi.fn(() => Promise.resolve()) };
}

function makeArchive(completedAt: Date, rankedItems = [{ rawItemId: 1, score: 0.9, rationale: "ok" }]): PipelineRunArchiveRow {
  return {
    id: "run-001",
    status: "completed",
    rankedItems,
    topN: 5,
    reviewed: true,
    completedAt,
    digestHeadline: null,
    digestSummary: null,
    hook: null,
    twitterSummary: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    emailSentAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    notificationState: null,
  };
}

function makeRawRow(overrides: Partial<RawItemRow> = {}): RawItemRow {
  return {
    id: 1,
    sourceType: "hn",
    externalId: "hn-1",
    title: "Story title",
    url: "https://news.ycombinator.com/item?id=1",
    sourceUrl: "https://news.ycombinator.com/item?id=1",
    author: null,
    content: null,
    imageUrl: null,
    publishedAt: null,
    engagement: { points: 10, commentCount: 1 },
    metadata: { comments: [] },
    ...overrides,
  };
}

async function captureStories(archive: PipelineRunArchiveRow, row: RawItemRow) {
  let capturedStories: unknown = null;
  const deps: EmailSendDeps = {
    emailProvider: {
      send: vi.fn(() => Promise.resolve({ messageId: "msg-1" })),
    },
    subscribersRepo: {
      listConfirmed: vi.fn(() => Promise.resolve([{
        id: "sub-1",
        email: "test@example.com",
        status: "confirmed" as const,
        confirmToken: null,
        confirmTokenExpiresAt: null,
        subscribedAt: new Date(),
        unsubscribedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }])),
      findByIds: vi.fn(() => Promise.resolve([])),
    },
    emailSendsRepo: {
      create: vi.fn(() => Promise.resolve({ id: "send-1" })),
      findSentSubscriberIds: vi.fn(() => Promise.resolve(new Set<string>())),
    },
    archiveRepo: {
      upsert: vi.fn(() => Promise.resolve()),
      findById: vi.fn(() => Promise.resolve(archive)),
      findLatestTerminal: vi.fn(() => Promise.resolve(archive)),
      markSlackNotified: vi.fn(() => Promise.resolve()),
      markEmailSent: vi.fn(() => Promise.resolve()),
      markNotification: vi.fn(() => Promise.resolve()),
      markLinkedInPosted: vi.fn(() => Promise.resolve()),
      markTwitterPosted: vi.fn(() => Promise.resolve()),
      recordSocialFailure: vi.fn(() => Promise.resolve()),
    },
    rawItemsRepo: {
      upsertItems: vi.fn(),
      findExistingExternalIds: vi.fn(() => Promise.resolve(new Set<string>())),
      findBySourceAndExternalId: vi.fn(() => Promise.resolve(null)),
      findByIds: vi.fn(() => Promise.resolve([row])),
      updateRecapData: vi.fn(),
      listForRun: vi.fn(() => Promise.resolve([])),
    },
    // Verified tenant: the (fail-closed, always-on) broadcast gate passes so
    // hydration is exercised end-to-end.
    tenantsRepo: {
      getSendingDomainStatus: vi.fn(() => Promise.resolve("verified" as const)),
    },
    renderNewsletter: vi.fn((props) => {
      capturedStories = props.stories;
      return Promise.resolve("<html>newsletter</html>");
    }),
    sessionSecret: "test-secret-32-bytes-long-at-least",
    fromMail: "newsletter@example.com",
    baseUrl: "https://newsletter.example.com",
    sendPacer: makeSendPacer(),
  };

  await handleEmailSendJob(deps, {
    name: "email-send",
    id: "job-1",
    data: { runId: "run-001" },
  });

  return capturedStories as { sourceLabel: string; sourceUrl: string; readVerb: string }[] | null;
}

describe("hydrateItems — enriched source attribution", () => {
  const postLaunchDate = new Date(ENRICHED_SUMMARY_LAUNCHED_AT.getTime() + 24 * 60 * 60 * 1000);
  const preLaunchDate = new Date(ENRICHED_SUMMARY_LAUNCHED_AT.getTime() - 24 * 60 * 60 * 1000);

  it("enriched item: sourceLabel=hostname, sourceUrl=enrichedUrl, readVerb='Read on <hostname>'", async () => {
    const archive = makeArchive(postLaunchDate);
    const row = makeRawRow({
      sourceType: "twitter",
      content: "tweet text",
      metadata: {
        comments: [],
        enrichedLink: {
          url: "https://theverge.com/article/123",
          fetchedAt: "2026-05-25T00:00:00Z",
          status: "ok",
          markdown: "# Full article content",
        },
      },
    });

    const stories = await captureStories(archive, row);

    expect(stories).not.toBeNull();
    const story = stories?.[0];
    expect(story?.sourceLabel).toBe("theverge.com");
    expect(story?.sourceUrl).toBe("https://theverge.com/article/123");
    expect(story?.readVerb).toBe("Read on theverge.com");
  });

  it("native item (no enrichment): sourceLabel=platform label, sourceUrl=item.url, readVerb='Read source'", async () => {
    const archive = makeArchive(postLaunchDate);
    const row = makeRawRow({
      sourceType: "hn",
      url: "https://news.ycombinator.com/item?id=1",
      content: null,
      metadata: { comments: [] },
    });

    const stories = await captureStories(archive, row);

    expect(stories).not.toBeNull();
    const story = stories?.[0];
    expect(story?.sourceLabel).toBe("Hacker News");
    expect(story?.sourceUrl).toBe("https://news.ycombinator.com/item?id=1");
    expect(story?.readVerb).toBe("Read source");
  });

  it("github item: readVerb='Read repo' regardless of enrichment", async () => {
    const archive = makeArchive(postLaunchDate);
    const row = makeRawRow({
      sourceType: "github",
      url: "https://github.com/owner/repo",
      content: null,
      metadata: { comments: [] },
    });

    const stories = await captureStories(archive, row);

    expect(stories).not.toBeNull();
    const story = stories?.[0];
    expect(story?.sourceLabel).toBe("GitHub");
    expect(story?.readVerb).toBe("Read repo");
  });

  it("legacy-gated: archive before launch date forces native semantics even if enriched data exists", async () => {
    const archive = makeArchive(preLaunchDate);
    const row = makeRawRow({
      sourceType: "twitter",
      content: "tweet text",
      metadata: {
        comments: [],
        enrichedLink: {
          url: "https://theverge.com/article/456",
          fetchedAt: "2026-05-24T00:00:00Z",
          status: "ok",
          markdown: "# Rich article content",
        },
      },
    });

    const stories = await captureStories(archive, row);

    expect(stories).not.toBeNull();
    // Legacy gate: must use platform label, not hostname
    const story = stories?.[0];
    expect(story?.sourceLabel).toBe("X / Twitter");
    expect(story?.sourceUrl).toBe(row.url);
    expect(story?.readVerb).toBe("Read source");
  });
});
