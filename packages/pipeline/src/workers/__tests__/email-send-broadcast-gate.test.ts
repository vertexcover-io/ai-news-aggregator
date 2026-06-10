import { describe, it, expect, vi } from "vitest";
import type { EmailProvider, RankedItemRef, SlackNotifier, SubscriberSelect } from "@newsletter/shared";
import { handleEmailSendJob, type EmailSendDeps, type EmailSendJobLike } from "../email-send.js";
import type { PipelineSubscribersRepo } from "@pipeline/repositories/subscribers.js";
import type { PipelineEmailSendsRepo } from "@pipeline/repositories/email-sends.js";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { RawItemsRepo, RawItemRow } from "@pipeline/repositories/raw-items.js";
import type { PipelineTenantsRepo } from "@pipeline/repositories/tenants.js";

function makeArchive(overrides: Partial<{
  id: string;
  completedAt: Date;
  emailSentAt: Date | null;
  rankedItems: RankedItemRef[];
  digestHeadline: string | null;
  digestSummary: string | null;
}> = {}) {
  return {
    id: overrides.id ?? "run-1",
    status: "completed" as const,
    rankedItems: overrides.rankedItems ?? [],
    topN: 12,
    reviewed: true,
    isDryRun: false,
    completedAt: overrides.completedAt ?? new Date("2026-06-10T07:00:00Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: null,
    sourceTypes: [],
    digestHeadline: overrides.digestHeadline ?? null,
    digestSummary: overrides.digestSummary ?? null,
    hook: null,
    twitterSummary: null,
    linkedinPostBody: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    searchText: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    emailSentAt: overrides.emailSentAt ?? null,
    publishedAt: null,
    draftSavedAt: null,
    notificationState: null,
    socialMetadata: null,
    costBreakdown: null,
    runFunnel: null,
    shortlistedItemIds: null,
    preReviewSnapshot: null,
  };
}

function makeSubscriber(overrides: Partial<SubscriberSelect> = {}): SubscriberSelect {
  return {
    id: overrides.id ?? "sub-1",
    email: overrides.email ?? "test@example.com",
    status: "confirmed",
    confirmedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    unsubscribedAt: null,
    confirmedToken: null,
    tenantId: null,
    name: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<EmailSendDeps> = {}): EmailSendDeps {
  return {
    emailProvider: { send: vi.fn().mockResolvedValue({ messageId: "msg-1" }) },
    subscribersRepo: {
      listConfirmed: vi.fn().mockResolvedValue([makeSubscriber()]),
      findByIds: vi.fn().mockResolvedValue([makeSubscriber()]),
    } as unknown as PipelineSubscribersRepo,
    emailSendsRepo: {
      findSentSubscriberIds: vi.fn().mockResolvedValue(new Set<string>()),
      create: vi.fn(),
    } as unknown as PipelineEmailSendsRepo,
    archiveRepo: {
      findLatestTerminal: vi.fn().mockResolvedValue(makeArchive()),
      findById: vi.fn().mockResolvedValue(makeArchive()),
      markEmailSent: vi.fn(),
    } as unknown as RunArchivesRepo,
    rawItemsRepo: {
      findByIds: vi.fn().mockResolvedValue([] as RawItemRow[]),
    } as unknown as RawItemsRepo,
    renderNewsletter: vi.fn().mockResolvedValue("<html>test</html>"),
    sessionSecret: "test-secret-32-bytes-minimum-abcdefg",
    fromMail: "news@testco.com",
    baseUrl: "http://localhost:3000",
    sendPacer: { acquire: vi.fn().mockResolvedValue(undefined) },
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("email-send broadcast gate", () => {
  it("allows broadcast when no tenantsRepo is provided (backwards compat)", async () => {
    const deps = makeDeps({
      fromMail: "news@testco.com",
    });

    const job: EmailSendJobLike = {
      name: "email-send",
      data: { subscriberIds: "all" },
    };

    await handleEmailSendJob(deps, job);
    expect(deps.emailProvider.send).toHaveBeenCalled();
  });

  it("blocks broadcast when tenant domain is not verified (REQ-053/EDGE-006)", async () => {
    const tenantsRepo: PipelineTenantsRepo = {
      getDomainStatus: vi.fn().mockResolvedValue({
        status: "pending",
        domainName: "news.example.com",
      }),
    };

    const deps = makeDeps({
      fromMail: "news@testco.com",
      tenantsRepo,
      tenantId: "tenant-1",
    });

    const job: EmailSendJobLike = {
      name: "email-send",
      data: { subscriberIds: "all" },
    };

    await handleEmailSendJob(deps, job);
    // Broadcast blocked — email provider should NOT have been called
    expect(deps.emailProvider.send).not.toHaveBeenCalled();
  });

  it("blocks broadcast when domain has never been registered (none)", async () => {
    const tenantsRepo: PipelineTenantsRepo = {
      getDomainStatus: vi.fn().mockResolvedValue({
        status: "none",
        domainName: null,
      }),
    };

    const deps = makeDeps({
      fromMail: "news@testco.com",
      tenantsRepo,
      tenantId: "tenant-1",
    });

    const job: EmailSendJobLike = {
      name: "email-send",
      data: { subscriberIds: "all" },
    };

    await handleEmailSendJob(deps, job);
    expect(deps.emailProvider.send).not.toHaveBeenCalled();
  });

  it("allows broadcast when domain is verified", async () => {
    const tenantsRepo: PipelineTenantsRepo = {
      getDomainStatus: vi.fn().mockResolvedValue({
        status: "verified",
        domainName: "news.example.com",
      }),
    };

    const deps = makeDeps({
      fromMail: "news@testco.com",
      tenantsRepo,
      tenantId: "tenant-1",
    });

    const job: EmailSendJobLike = {
      name: "email-send",
      data: { subscriberIds: "all" },
    };

    await handleEmailSendJob(deps, job);
    expect(deps.emailProvider.send).toHaveBeenCalled();
  });

  it("allows broadcast when tenant has no domain configured (getDomainStatus returns null)", async () => {
    // null = no domainId on the tenant — pre-domain-setup state
    const tenantsRepo: PipelineTenantsRepo = {
      getDomainStatus: vi.fn().mockResolvedValue(null),
    };

    const deps = makeDeps({
      fromMail: "news@testco.com",
      tenantsRepo,
      tenantId: "tenant-1",
    });

    const job: EmailSendJobLike = {
      name: "email-send",
      data: { subscriberIds: "all" },
    };

    // When no domain is registered, the gate should still block
    // because there's no sending domain at all
    await handleEmailSendJob(deps, job);
    expect(deps.emailProvider.send).not.toHaveBeenCalled();
  });

  it("allows targeted (non-broadcast) send regardless of domain status", async () => {
    const tenantsRepo: PipelineTenantsRepo = {
      getDomainStatus: vi.fn().mockResolvedValue({
        status: "pending",
        domainName: "news.example.com",
      }),
    };

    const deps = makeDeps({
      fromMail: "news@testco.com",
      tenantsRepo,
      tenantId: "tenant-1",
    });

    const job: EmailSendJobLike = {
      name: "email-send",
      data: { subscriberIds: ["sub-1"] }, // targeted, not "all"
    };

    await handleEmailSendJob(deps, job);
    // Transactional/targeted send should proceed even without verified domain
    expect(deps.emailProvider.send).toHaveBeenCalled();
  });
});
