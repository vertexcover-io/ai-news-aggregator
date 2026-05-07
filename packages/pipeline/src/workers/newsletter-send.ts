import { createHmac } from "node:crypto";
import { createLogger } from "@newsletter/shared/logger";
import type { EmailProvider, NewsletterSendJobPayload, RankedItemRef, RecapContent, SlackNotifier } from "@newsletter/shared";
import type { PipelineSubscribersRepo } from "@pipeline/repositories/subscribers.js";
import type { PipelineEmailSendsRepo } from "@pipeline/repositories/email-sends.js";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { RawItemsRepo, RawItemRow } from "@pipeline/repositories/raw-items.js";

const logger = createLogger("worker:newsletter-send");

const BATCH_SIZE = 50;

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
  replyToEmail?: string;
}

export interface NewsletterSendDeps {
  emailProvider: EmailProvider;
  subscribersRepo: PipelineSubscribersRepo;
  emailSendsRepo: PipelineEmailSendsRepo;
  archiveRepo: RunArchivesRepo;
  rawItemsRepo: RawItemsRepo;
  renderNewsletter: (props: NewsletterRenderProps) => Promise<string>;
  sessionSecret: string;
  sesFromEmail: string;
  replyToEmail?: string;
  baseUrl: string;
  slackNotifier?: SlackNotifier;
}

export interface NewsletterSendJobLike {
  name: string;
  id?: string;
  data: NewsletterSendJobPayload;
}

function issueUnsubToken(subscriberId: string, secret: string): string {
  const expires = Date.now() + 365 * 24 * 60 * 60 * 1000;
  const payload = `${subscriberId}:unsub:${expires}`;
  const mac = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(payload).toString("base64url") + "." + mac;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatArchiveDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Boil a provider error message down to a short, actionable category.
 * Strategic by design: the full per-recipient error stays in the structured
 * log; the notifier surface gets a single human-grokkable label per class.
 */
function classifyDeliveryFailure(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("rate limit") || m.includes("too many requests")) {
    return "rate limit";
  }
  if (m.includes("domain is not verified") || m.includes("domain not verified")) {
    return "unverified sender domain";
  }
  if (m.includes("bounce") || m.includes("mailbox") || m.includes("recipient")) {
    return "recipient rejected";
  }
  if (m.includes("invalid") && m.includes("address")) {
    return "invalid recipient address";
  }
  if (m.includes("timeout") || m.includes("etimedout") || m.includes("econnreset")) {
    return "network timeout";
  }
  if (m.includes("auth") || m.includes("unauthorized") || m.includes("forbidden")) {
    return "auth/permission denied";
  }
  // Fallback: keep it short — first sentence or first 60 chars.
  const firstSentence = message.split(/[.\n]/)[0]?.trim() ?? message;
  return firstSentence.length > 60
    ? firstSentence.slice(0, 59).trimEnd() + "…"
    : firstSentence;
}

function hydrateItems(refs: RankedItemRef[], rows: RawItemRow[]): NewsletterStory[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const stories: NewsletterStory[] = [];
  for (const ref of refs) {
    const row = byId.get(ref.rawItemId);
    if (!row) continue;
    const rawRecap = row.metadata.recap;
    const hasRefRecap =
      ref.summary !== undefined ||
      ref.bullets !== undefined ||
      ref.bottomLine !== undefined;
    let recap: RecapContent | null = null;
    if (hasRefRecap) {
      recap = {
        summary: ref.summary ?? rawRecap?.summary ?? "",
        bullets: ref.bullets ?? rawRecap?.bullets ?? [],
        bottomLine: ref.bottomLine ?? rawRecap?.bottomLine ?? "",
      };
    } else if (rawRecap) {
      recap = rawRecap;
    }
    stories.push({
      title: row.title,
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

  if (candidates.length === 0) {
    logger.info(
      { event: "newsletter-send.no-recipients", runId, jobId: job.id },
      "newsletter-send: no recipients",
    );
    return;
  }

  const alreadySent = await deps.emailSendsRepo.findSentSubscriberIds(runId);
  const toSend = candidates.filter((s) => !alreadySent.has(s.id));

  if (toSend.length === 0) {
    logger.info(
      { event: "newsletter-send.all-already-sent", runId, jobId: job.id },
      "newsletter-send: all subscribers already received this issue",
    );
    return;
  }

  const issueDate = formatArchiveDate(archive.completedAt);
  const subject = `AI Newsletter — ${issueDate}`;
  const batches = chunk(toSend, BATCH_SIZE);

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

  let okCount = 0;
  let failCount = 0;
  const failureReasonCounts = new Map<string, number>();
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
            replyToEmail: deps.replyToEmail,
          });
          const result = await deps.emailProvider.send({
            to: [subscriber.email],
            from: deps.sesFromEmail,
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
            reason,
            (failureReasonCounts.get(reason) ?? 0) + 1,
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

  if (deps.slackNotifier) {
    try {
      await deps.slackNotifier.notifyNewsletterSent({
        runId,
        delivery: {
          attempted: toSend.length,
          sent: okCount,
          failed: failCount,
          failureReasons: failureReasons.length > 0 ? failureReasons : undefined,
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
