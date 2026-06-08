/**
 * One-time AgentLoop reader-feedback campaign sender.
 *
 * SAFETY: dry-run by default. It renders every email and writes previews +
 * a manifest to .harness/runtime/feedback-campaign/ but sends NOTHING unless
 * BOTH `--send` is passed AND the env var CONFIRM_SEND=YES is set. This double
 * gate exists so a real send can never happen by accident.
 *
 * Usage:
 *   # dry run (default) — renders previews + manifest, sends nothing
 *   pnpm --filter @newsletter/api exec tsx scripts/send-feedback-campaign.ts
 *
 *   # send a single test to yourself
 *   pnpm --filter @newsletter/api exec tsx scripts/send-feedback-campaign.ts --only you@example.com --send   # (needs CONFIRM_SEND=YES)
 *
 *   # real send to everyone in the CSV
 *   CONFIRM_SEND=YES pnpm --filter @newsletter/api exec tsx scripts/send-feedback-campaign.ts --send
 *
 * Env: DATABASE_URL, SESSION_SECRET, FROM_MAIL (display "AgentLoop"),
 *      API base URL (PUBLIC_BASE_URL / NEWSLETTER_BASE_URL), FEEDBACK_CAMPAIGN.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

import { getDb } from "@newsletter/shared/db";
import { createSubscribersRepo } from "../src/repositories/subscribers.js";
import { issueSubscriberToken } from "../src/lib/subscriber-token.js";
import { renderFeedback } from "../src/lib/email/templates/index.js";
import { createEmailProvider } from "../src/lib/email/provider.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const REPLY_TO = "newsletter-feedback@vertexcover.io";
const SUBJECT = "AgentLoop - Are you reading our newsletters?";
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // links live for the 2-week campaign window
const PREVIEW_LIMIT = 3;

interface Args {
  send: boolean;
  csvPath: string;
  only?: string;
  limit?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    send: argv.includes("--send"),
    csvPath: resolve(REPO_ROOT, "subscribers_with_names.csv"),
  };
  const onlyIdx = argv.indexOf("--only");
  if (onlyIdx !== -1 && argv[onlyIdx + 1]) args.only = argv[onlyIdx + 1];
  const limitIdx = argv.indexOf("--limit");
  if (limitIdx !== -1 && argv[limitIdx + 1]) args.limit = Number(argv[limitIdx + 1]);
  const csvIdx = argv.indexOf("--csv");
  if (csvIdx !== -1 && argv[csvIdx + 1]) args.csvPath = resolve(process.cwd(), argv[csvIdx + 1]);
  return args;
}

interface Recipient {
  email: string;
  firstName: string;
}

function parseCsv(path: string): Recipient[] {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const out: Recipient[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const [email, firstName] = line.split(",");
    if (email) out.push({ email: email.trim(), firstName: (firstName ?? "").trim() });
  }
  return out;
}

function feedbackLinks(apiBaseUrl: string, token: string): { loveUrl: string; mehUrl: string; nahUrl: string } {
  const base = `${apiBaseUrl.replace(/\/$/, "")}/api/feedback?token=${encodeURIComponent(token)}`;
  return { loveUrl: `${base}&v=love`, mehUrl: `${base}&v=meh`, nahUrl: `${base}&v=nah` };
}

function feedbackText(r: { firstName: string; loveUrl: string; mehUrl: string; nahUrl: string }): string {
  const name = r.firstName !== "" ? r.firstName : "there";
  return [
    `Hey ${name},`,
    "",
    "You've been getting the AgentLoop AI digest from us for a few weeks now, and we wanted to check in. We read every reply ourselves, so this goes straight to the people building it.",
    "",
    "One tap, that's the whole ask. How's it landing for you?",
    "",
    `  Genuinely useful, keep it coming:  ${r.loveUrl}`,
    `  It's fine, I skim it:              ${r.mehUrl}`,
    `  Not really for me:                 ${r.nahUrl}`,
    "",
    "And if anything's annoying you, like too long, wrong topics, lands at a bad time, or broken links, just hit reply and tell us. Even one line helps a lot.",
    "",
    "Thanks for reading,",
    "— The Vertexcover team",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) throw new Error("SESSION_SECRET is required");
  const apiBaseUrl = process.env.PUBLIC_BASE_URL ?? process.env.NEWSLETTER_BASE_URL ?? process.env.API_BASE_URL;
  if (!apiBaseUrl) throw new Error("Set PUBLIC_BASE_URL (or NEWSLETTER_BASE_URL / API_BASE_URL) to the API origin");
  const fromMail = process.env.FROM_MAIL ?? "AgentLoop <newsletter@news.vertexcover.io>";

  let recipients = parseCsv(args.csvPath);
  if (args.only) recipients = recipients.filter((r) => r.email === args.only);
  if (args.limit !== undefined) recipients = recipients.slice(0, args.limit);

  const repo = createSubscribersRepo(getDb());
  const outDir = resolve(REPO_ROOT, ".harness/runtime/feedback-campaign");
  mkdirSync(outDir, { recursive: true });

  const reallySend = args.send && process.env.CONFIRM_SEND === "YES";
  const provider = reallySend ? createEmailProvider() : null;

  console.log(`\nAgentLoop feedback campaign — ${reallySend ? "🔴 LIVE SEND" : "DRY RUN (no email will be sent)"}`);
  console.log(`Recipients in CSV: ${recipients.length} · Reply-To: ${REPLY_TO} · From: ${fromMail}\n`);

  const manifest: Array<Record<string, unknown>> = [];
  let prepared = 0;
  let sent = 0;
  let skipped = 0;

  for (const r of recipients) {
    const subscriber = await repo.findByEmail(r.email);
    const status = subscriber?.status ?? "MISSING";
    if (!subscriber || subscriber.status !== "confirmed") {
      console.warn(`  ⤬ skip ${r.email} — status=${status} (only confirmed subscribers are mailed)`);
      manifest.push({ email: r.email, firstName: r.firstName, status, action: "skipped" });
      skipped += 1;
      continue;
    }

    const token = issueSubscriberToken(subscriber.id, "feedback", sessionSecret, new Date(Date.now() + TOKEN_TTL_MS));
    const links = feedbackLinks(apiBaseUrl, token);
    const html = await renderFeedback({ firstName: r.firstName || undefined, ...links });
    const text = feedbackText({ firstName: r.firstName, ...links });
    prepared += 1;

    if (prepared <= PREVIEW_LIMIT) {
      writeFileSync(resolve(outDir, `preview-${r.email.replace(/[^a-z0-9]/gi, "_")}.html`), html);
    }
    manifest.push({ email: r.email, firstName: r.firstName, status, action: reallySend ? "sent" : "dry-run" });

    if (reallySend && provider) {
      await provider.send({ to: [r.email], from: fromMail, replyTo: REPLY_TO, subject: SUBJECT, html, text });
      sent += 1;
      console.log(`  ✓ sent ${r.email}`);
    } else {
      console.log(`  • prepared ${r.email} (${r.firstName || "no name"})`);
    }
  }

  writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\nPrepared: ${prepared} · Sent: ${sent} · Skipped: ${skipped}`);
  console.log(`Previews + manifest: ${outDir}`);
  if (!reallySend) {
    console.log("\nNo emails were sent. To send for real: re-run with --send AND CONFIRM_SEND=YES.\n");
  }
  process.exit(0);
}

void main().catch((err: unknown) => {
  console.error("feedback campaign failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
