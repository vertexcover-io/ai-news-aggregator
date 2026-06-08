import { createLogger, type Logger } from "@newsletter/shared/logger";
import type { EmailProvider, NewsletterSendJobPayload, RankedItemRef, RecapContent, SlackNotifier, SocialPostReport, SubscriberSelect } from "@newsletter/shared";
import type { PipelineSubscribersRepo } from "@pipeline/repositories/subscribers.js";
import type { PipelineEmailSendsRepo } from "@pipeline/repositories/email-sends.js";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { RawItemsRepo, RawItemRow } from "@pipeline/repositories/raw-items.js";
import type { LinkedInNotifier } from "@pipeline/social/linkedin/index.js";
import type { TwitterNotifier } from "@pipeline/social/twitter/index.js";
import type { SocialResult } from "@pipeline/social/types.js";
import {
  type SendPacer,
  createSendPacer,
  issueUnsubToken,
  htmlToPlainText,
  formatArchiveDate,
  chunk,
  classifyDeliveryFailure,
} from "@pipeline/lib/email-send-common.js";

export type { SendPacer };

const logger = createLogger("worker:newsletter-send");

const BATCH_SIZE = 50;
const SEND_RATE_PER_SECOND = 5;

export interface NewsletterStory {
  title: string;
  url: string;
  summary?: string;
  bullets?: string[];
  bottomLine?: string;
  imageUrl?: string;
}

export interface NewsletterRenderProps {
  stories: NewsletterStory[];
  issueDate: string;
  issueNumber: number;
  unsubscribeUrl: string;
  baseUrl: string;
  archiveUrl: string;
  replyToEmail?: string;
  digestHeadline?: string | null;
  digestSummary?: string | null;
}

export interface NewsletterSendDeps {
  emailProvider: EmailProvider;
  subscribersRepo: PipelineSubscribersRepo;
  emailSendsRepo: PipelineEmailSendsRepo;
  archiveRepo: RunArchivesRepo;
  rawItemsRepo: RawItemsRepo;
  renderNewsletter: (props: NewsletterRenderProps) => Promise<string>;
  sessionSecret: string;
  fromMail: string;
  replyToEmail?: string;
  baseUrl: string;
  slackNotifier?: SlackNotifier;
  linkedinNotifier?: LinkedInNotifier | null;
  twitterNotifier?: TwitterNotifier | null;
  sendPacer?: SendPacer;
}

function settledToReport(
  s: PromiseSettledResult<SocialResult | null>,
  platform: "linkedin" | "twitter",
  log: Logger,
  runId: string,
): SocialResult | null {
  if (s.status === "fulfilled") return s.value;
  log.error(
    {
      event: `social.${platform}.unexpected_throw`,
      runId,
      error: s.reason instanceof Error ? s.reason.message : String(s.reason),
    },
    `social.${platform}.unexpected_throw`,
  );
  return { status: "failed", reason: "unexpected" };
}

function toSocialPostReport(r: SocialResult | null): SocialPostReport | undefined {
  if (r === null) return undefined;
  if (r.status === "posted") {
    return { status: "posted", permalink: r.permalink };
  }
  return { status: r.status, reason: r.reason };
}

export interface NewsletterSendJobLike {
  name: string;
  id?: string;
  data: NewsletterSendJobPayload;
}

function hydrateItems(refs: RankedItemRef[], rows: RawItemRow[]): NewsletterStory[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const stories: NewsletterStory[] = [];
  for (const ref of refs) {
    const row = byId.get(ref.rawItemId);
    if (!row) continue;
    const rawRecap = row.metadata.recap;
    const hasRefRecap =
      ref.title !== undefined ||
      ref.summary !== undefined ||
      ref.bullets !== undefined ||
      ref.bottomLine !== undefined;
    let recap: RecapContent | null = null;
    if (hasRefRecap) {
      recap = {
        title: ref.title ?? rawRecap?.title ?? "",
        summary: ref.summary ?? rawRecap?.summary ?? "",
        bullets: ref.bullets ?? rawRecap?.bullets ?? [],
        bottomLine: ref.bottomLine ?? rawRecap?.bottomLine ?? "",
      };
    } else if (rawRecap) {
      recap = rawRecap;
    }
    const displayTitle = ref.title ?? rawRecap?.title ?? row.title;
    stories.push({
      title: displayTitle,
      url: row.url,
      summary: recap?.summary,
      bullets: recap?.bullets,
      bottomLine: recap?.bottomLine,
      imageUrl: ref.imageUrl !== undefined ? (ref.imageUrl ?? undefined) : (row.imageUrl ?? undefined),
    });
  }
  return stories;
}

export async function handleNewsletterSendJob(
  deps: NewsletterSendDeps,
  job: NewsletterSendJobLike,
): Promise<void> {
  if (job.name !== "send-newsletter") return;

  const { runId, subscriberIds } = job.data;

  const archive = await deps.archiveRepo.findById(runId);
  if (!archive) {
    logger.warn(
      { event: "newsletter-send.archive-not-found", runId, jobId: job.id },
      "newsletter-send: archive not found",
    );
    return;
  }

  const rawIds = archive.rankedItems.map((r) => r.rawItemId);
  const rawRows = await deps.rawItemsRepo.findByIds(rawIds);
  const stories = hydrateItems(archive.rankedItems, rawRows);

  const candidates =
    subscriberIds === "all"
      ? await deps.subscribersRepo.listConfirmed()
      : await deps.subscribersRepo.findByIds(subscriberIds);

  let toSend: SubscriberSelect[] = [];
  if (candidates.length === 0) {
    logger.info(
      { event: "newsletter-send.no-recipients", runId, jobId: job.id },
      "newsletter-send: no recipients",
    );
  } else {
    const alreadySent = await deps.emailSendsRepo.findSentSubscriberIds(runId);
    toSend = candidates.filter((s) => !alreadySent.has(s.id));
    if (toSend.length === 0) {
      logger.info(
        { event: "newsletter-send.all-already-sent", runId, jobId: job.id },
        "newsletter-send: all subscribers already received this issue",
      );
    }
  }

  const issueDate = formatArchiveDate(archive.completedAt);
  const subject = `AI Newsletter — ${issueDate}`;
  const batches = chunk(toSend, BATCH_SIZE);

  if (toSend.length > 0) {
    logger.info(
      {
        event: "newsletter-send.started",
        runId,
        jobId: job.id,
        total: toSend.length,
        batches: batches.length,
      },
      "newsletter-send started",
    );
  }

  let okCount = 0;
  let failCount = 0;
  const failureReasonCounts = new Map<string, number>();
  const pacer = deps.sendPacer ?? createSendPacer(SEND_RATE_PER_SECOND);
  for (const batch of batches) {
    await Promise.allSettled(
      batch.map(async (subscriber) => {
        try {
          const unsubToken = issueUnsubToken(subscriber.id, deps.sessionSecret);
          const unsubUrl = `${deps.baseUrl}/api/unsubscribe?token=${unsubToken}`;
          const html = await deps.renderNewsletter({
            stories,
            issueDate,
            issueNumber: 1,
            unsubscribeUrl: unsubUrl,
            baseUrl: deps.baseUrl,
            archiveUrl: `${deps.baseUrl}/archive/${runId}`,
            replyToEmail: deps.replyToEmail,
            digestHeadline: archive.digestHeadline,
            digestSummary: archive.digestSummary,
          });
          await pacer.acquire();
          const result = await deps.emailProvider.send({
            to: [subscriber.email],
            from: deps.fromMail,
            replyTo: deps.replyToEmail,
            subject,
            html,
            text: htmlToPlainText(html),
            headers: {
              "List-Unsubscribe": `<${unsubUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          });
          await deps.emailSendsRepo.create({
            subscriberId: subscriber.id,
            runArchiveId: runId,
            messageId: result.messageId,
          });
          okCount += 1;
          logger.info(
            {
              event: "newsletter-send.sent",
              runId,
              subscriberId: subscriber.id,
              messageId: result.messageId,
            },
            "newsletter-send: sent to subscriber",
          );
        } catch (err) {
          failCount += 1;
          const rawMessage = err instanceof Error ? err.message : String(err);
          const reason = classifyDeliveryFailure(rawMessage);
          failureReasonCounts.set(
            rawMessage,
            (failureReasonCounts.get(rawMessage) ?? 0) + 1,
          );
          logger.error(
            {
              event: "newsletter-send.failed",
              runId,
              subscriberId: subscriber.id,
              error: rawMessage,
              reason,
            },
            "newsletter-send: failed to send to subscriber",
          );
          throw err;
        }
      }),
    );
  }
  const failureReasons = [...failureReasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  logger.info(
    {
      event: "newsletter-send.completed",
      runId,
      jobId: job.id,
      attempted: toSend.length,
      sent: okCount,
      failed: failCount,
    },
    "newsletter-send completed",
  );

  const [linkedinSettled, twitterSettled] = await Promise.allSettled([
    deps.linkedinNotifier
      ? deps.linkedinNotifier.notifyArchiveReady({ runId })
      : Promise.resolve<SocialResult | null>(null),
    deps.twitterNotifier
      ? deps.twitterNotifier.notifyArchiveReady({ runId })
      : Promise.resolve<SocialResult | null>(null),
  ]);
  const linkedinResult = settledToReport(linkedinSettled, "linkedin", logger, runId);
  const twitterResult = settledToReport(twitterSettled, "twitter", logger, runId);

  if (deps.slackNotifier) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy worker, see split-slack-notifications spec
      await deps.slackNotifier.notifyNewsletterSent({
        runId,
        delivery: {
          attempted: toSend.length,
          sent: okCount,
          failed: failCount,
          failureReasons: failureReasons.length > 0 ? failureReasons : undefined,
        },
        socialResults: {
          linkedin: toSocialPostReport(linkedinResult),
          twitter: toSocialPostReport(twitterResult),
        },
      });
    } catch (err) {
      logger.error(
        {
          event: "slack.notify.unexpected_throw",
          runId,
          error: err instanceof Error ? err.message : String(err),
        },
        "slack.notify.unexpected_throw",
      );
    }
  }
}
