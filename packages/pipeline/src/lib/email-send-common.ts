/**
 * Shared helpers used by both email-send.ts and newsletter-send.ts workers.
 *
 * The SendPacer module-level singleton remains in email-send.ts to preserve
 * its shared-pacing semantics across all email-send job invocations in the
 * process. Only the factory and interface are exported from here so
 * newsletter-send can construct its own pacer without sharing the singleton.
 */
import { createHmac } from "node:crypto";
import { delay } from "@pipeline/lib/delay.js";

// ---- SendPacer ----------------------------------------------------------------

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

// ---- Token helpers ------------------------------------------------------------

export function issueUnsubToken(subscriberId: string, secret: string): string {
  const expires = Date.now() + 365 * 24 * 60 * 60 * 1000;
  const payload = `${subscriberId}:unsub:${expires}`;
  const mac = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(payload).toString("base64url") + "." + mac;
}

// ---- HTML utilities -----------------------------------------------------------

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Date formatting ----------------------------------------------------------

export function formatArchiveDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ---- Array utilities ----------------------------------------------------------

export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ---- Failure classification ---------------------------------------------------

/**
 * Boil a provider error message down to a short, actionable category.
 * Strategic by design: the full per-recipient error stays in the structured
 * log; the notifier surface gets a single human-grokkable label per class.
 */
export function classifyDeliveryFailure(message: string): string {
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
