import { createHmac } from "node:crypto";
import { createLogger } from "@newsletter/shared/logger";
import type { EmailProvider, RankedItemRef, RecapContent, SlackNotifier, SubscriberSelect } from "@newsletter/shared";
import { EmailSendError } from "@newsletter/shared";
import type { PipelineSubscribersRepo } from "@pipeline/repositories/subscribers.js";
import type { PipelineEmailSendsRepo } from "@pipeline/repositories/email-sends.js";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { RawItemsRepo, RawItemRow } from "@pipeline/repositories/raw-items.js";
import { delay } from "@pipeline/lib/delay.js";
import { resolvePublishTarget } from "./publish-target.js";
import { pickSummarySource, getPlatformLabel } from "@newsletter/shared/services";
import { ENRICHED_SUMMARY_LAUNCHED_AT } from "@newsletter/shared/constants";

const logger = createLogger("worker:email-send");

const BATCH_SIZE = 50;
const DEFAULT_SEND_RATE_PER_SECOND = 3;

export function resolveSendRate(env: NodeJS.ProcessEnv | Record<string, string | undefined>): number {
  const raw = env.EMAIL_SEND_RATE_PER_SECOND;
  if (raw === undefined || raw === "") return DEFAULT_SEND_RATE_PER_SECOND;
  // Must be a positive integer string — no decimals, no negatives, no zero
  if (!/^\d+$/.test(raw)) return DEFAULT_SEND_RATE_PER_SECOND;
  const n = parseInt(raw, 10);
  if (n <= 0) return DEFAULT_SEND_RATE_PER_SECOND;
  return n;
}

let sharedPacer: SendPacer | null = null;

export function getSharedPacer(): SendPacer {
  sharedPacer ??= createSendPacer(resolveSendRate(process.env));
  return sharedPacer;
}

export function resetSharedPacerForTests(): void {
  sharedPacer = null;
}

export interface SendPacer {
  acquire(): Promise<void>;
}

interface PacerClock {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Fixed-interval pacer: enforces a minimum spacing of `ceil(1000 / rate)` ms
 * between successive permits. For rate = 5 that's 200 ms between sends, which
 * guarantees the provider can never observe more than `rate` starts in any
 * rolling 1-second window — even if its rate-limit bucket boundary differs
 * from ours. A pure sliding-window admission policy can let 5 sends bunch at
 * the start of a window and trip the provider when its bucket happens to
 * straddle that bunch; fixed spacing avoids the issue entirely.
 *
 * Acquisition is serialized via an internal queue so concurrent `acquire()`
 * callers wait their turn; the caller then proceeds and any downstream async
 * work (e.g. `emailProvider.send(...)`) runs in parallel with later
 * acquisitions.
 */
export function createSendPacer(rate: number, deps: PacerClock = {}): SendPacer {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? delay;
  const minIntervalMs = Math.ceil(1000 / rate);
  let nextAvailableAt = 0;
  let chain: Promise<void> = Promise.resolve();

  async function next(): Promise<void> {
    const t = now();
    if (t < nextAvailableAt) {
      await sleep(nextAvailableAt - t);
    }
    nextAvailableAt = Math.max(now(), nextAvailableAt) + minIntervalMs;
  }

  return {
    acquire(): Promise<void> {
      const run = chain.then(next);
      chain = run.catch(() => undefined);
      return run;
    },
  };
}

export interface NewsletterStory {
  title: string;
  url: string;
  summary?: string;
  bullets?: string[];
  bottomLine?: string;
  imageUrl?: string;
  sourceLabel: string;
  sourceUrl: string;
  readVerb: string;
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

export interface EmailSendDeps {
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
  sendPacer?: SendPacer;
  sleep?: (ms: number) => Promise<void>;
}

export interface EmailSendJobLike {
  name: string;
  id?: string;
  data: { runId?: string; subscriberIds?: string[] | "all" };
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

function isRetryable(err: unknown): boolean {
  if (err instanceof EmailSendError) return err.retryable;
  // Network/timeout heuristic for non-typed errors (e.g. SES path, fetch failures)
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes("timeout") || msg.includes("etimedout") || msg.includes("econnreset");
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

function hydrateItems(refs: RankedItemRef[], rows: RawItemRow[], archiveCompletedAt: Date): NewsletterStory[] {
  const isLegacy = archiveCompletedAt < ENRICHED_SUMMARY_LAUNCHED_AT;
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

    let sourceLabel: string;
    let sourceUrl: string;
    let readVerb: string;
    if (!isLegacy) {
      const summarySource = pickSummarySource(row.content, row.metadata.enrichedLink);
      if (summarySource.kind === "enriched") {
        sourceLabel = summarySource.hostname;
        sourceUrl = summarySource.url;
        readVerb = `Read on ${summarySource.hostname}`;
      } else {
        sourceLabel = getPlatformLabel(row.sourceType);
        sourceUrl = row.url;
        readVerb = row.sourceType === "github" ? "Read repo" : "Read source";
      }
    } else {
      sourceLabel = getPlatformLabel(row.sourceType);
      sourceUrl = row.url;
      readVerb = row.sourceType === "github" ? "Read repo" : "Read source";
    }

    stories.push({
      title: displayTitle,
      url: row.url,
      summary: recap?.summary,
      bullets: recap?.bullets,
      bottomLine: recap?.bottomLine,
      imageUrl: ref.imageUrl !== undefined ? (ref.imageUrl ?? undefined) : (row.imageUrl ?? undefined),
      sourceLabel,
      sourceUrl,
      readVerb,
    });
  }
  return stories;
}

export async function handleEmailSendJob(
  deps: EmailSendDeps,
  job: EmailSendJobLike,
): Promise<void> {
  if (job.name !== "email-send") return;

  const { runId: explicitRunId, subscriberIds = "all" } = job.data;
  const isBroadcast = subscriberIds === "all";

  const archive = await resolvePublishTarget(deps, {
    channel: "email-send",
    runId: explicitRunId,
  });
  if (!archive) {
    logger.warn(
      { event: "newsletter-send.archive-not-found", runId: explicitRunId, jobId: job.id },
      "newsletter-send: archive not found",
    );
    return;
  }
  // `email_sent_at` is the BROADCAST idempotency marker — it must only gate (and
  // only be set by) the daily all-subscribers send. Targeted sends (e.g. the
  // welcome back-issue to a single new subscriber) must neither be blocked by it
  // nor set it, or they would poison the broadcast guard and the daily send
  // would silently no-op. Per-subscriber dedup (the `email_sends` table) already
  // prevents duplicate delivery in both modes.
  if (isBroadcast && archive.emailSentAt !== null) return;
  const runId = archive.id;

  const rawIds = archive.rankedItems.map((r) => r.rawItemId);
  const rawRows = await deps.rawItemsRepo.findByIds(rawIds);
  const stories = hydrateItems(archive.rankedItems, rawRows, archive.completedAt);

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
  const pacer = deps.sendPacer ?? getSharedPacer();
  const sleep = deps.sleep ?? delay;

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

          const MAX_ATTEMPTS = 2;
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            await pacer.acquire();
            try {
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
              return; // success — exit the attempt loop
            } catch (sendErr) {
              const retryable = isRetryable(sendErr);
              if (retryable && attempt < MAX_ATTEMPTS) {
                const backoffMs =
                  sendErr instanceof EmailSendError && sendErr.retryAfterMs !== null
                    ? sendErr.retryAfterMs
                    : attempt * 1000;
                await sleep(backoffMs);
                continue; // loop re-acquires pacer for next attempt
              }
              throw sendErr; // exhausted or non-retryable → fall through to outer catch
            }
          }
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

  // Only a broadcast stamps the archive-level marker and fires the "newsletter
  // emailed" Slack summary. A targeted welcome send neither marks the archive
  // (see the broadcast-guard note above) nor emits the digest-level summary.
  if (!isBroadcast) {
    return;
  }

  await deps.archiveRepo.markEmailSent(runId, new Date());

  if (deps.slackNotifier) {
    try {
      await deps.slackNotifier.notifyEmailDelivery({
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
