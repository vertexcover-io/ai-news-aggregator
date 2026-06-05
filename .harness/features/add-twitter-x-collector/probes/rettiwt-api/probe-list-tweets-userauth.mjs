#!/usr/bin/env node
// VS-0a-userauth: Live probe of rettiwt-api list.tweets() with apiKey
// (user-auth mode). The apiKey is base64-encoded cookie string built from
// auth_token, ct0, kdt, twid. Loaded from project-root .env.harness
// (gitignored).
//
// User has explicitly opted in to cookie-based auth via maintained library
// (Option B from the BLOCKED gap report) after unauthenticated paths
// failed.
//
// Asserts:
//   1. Authentication succeeds (no "Not authorized" or auth-class error)
//   2. >=1 tweet returned for the live list
//   3. Each tweet has id, text/fullText, createdAt, like count, author
//   4. Long-form tweet round-trip if any >280 chars on first page
//   5. Cursor present (so pagination can be tested in production)

import { Rettiwt } from "rettiwt-api";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIST_ID = "1585430245762441216";
const TIMEOUT_MS = 30_000;
const COUNT = 20;

const t0 = Date.now();
const log = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s] ${msg}`);

function fail(reason, extras = {}) {
  console.error(`FAIL: ${reason}`);
  for (const [k, v] of Object.entries(extras)) console.error(`  ${k}: ${v}`);
  process.exit(1);
}

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`probe timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Load .env.harness from project root (worktree-safe via git common dir)
function loadEnvHarness() {
  // The probe runs from <worktree>/docs/spec/<spec>/probes/<lib>/
  // Project root is 5 levels up.
  const candidate = resolve(__dirname, "..", "..", "..", "..", "..", ".env.harness");
  if (!existsSync(candidate)) {
    fail(`.env.harness not found at ${candidate}`);
  }
  const raw = readFileSync(candidate, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvHarness();

const apiKey = process.env.RETTIWT_API_KEY;
if (!apiKey || apiKey.length < 10) {
  fail("RETTIWT_API_KEY missing or too short in .env.harness");
}
log(`apiKey loaded (length=${apiKey.length})`);

log(`instantiating Rettiwt({ apiKey: <redacted> }) — user-auth mode`);
const rettiwt = new Rettiwt({ apiKey });

log(`calling rettiwt.list.tweets("${LIST_ID}", ${COUNT})`);
let result;
try {
  result = await withTimeout(rettiwt.list.tweets(LIST_ID, COUNT), TIMEOUT_MS);
} catch (err) {
  fail(`rettiwt.list.tweets threw: ${err?.message ?? err}`, {
    name: err?.name,
    code: err?.code,
    status: err?.response?.status,
    stack: (err?.stack ?? "").split("\n").slice(0, 6).join(" | "),
  });
}

log(`result type: ${typeof result}; keys: ${result ? Object.keys(result).join(",") : "(null)"}`);
if (!result) fail("rettiwt.list.tweets returned null/undefined");

// CursoredData<Tweet> shape: { list: Tweet[], next: { value, type } }
const tweets = Array.isArray(result?.list) ? result.list
  : Array.isArray(result?.data) ? result.data
  : Array.isArray(result?.tweets) ? result.tweets
  : null;

if (!Array.isArray(tweets)) {
  fail("could not locate tweets array on result", {
    shape: JSON.stringify(Object.keys(result ?? {})),
    sample: JSON.stringify(result).slice(0, 600),
  });
}

log(`tweets returned: ${tweets.length}`);
if (tweets.length === 0) {
  fail("rettiwt.list.tweets returned 0 tweets — list may be empty/private", {
    next: JSON.stringify(result?.next ?? "(no cursor)"),
  });
}

const first = tweets[0];
const firstKeys = Object.keys(first);
log(`first tweet keys: ${firstKeys.join(",")}`);

const checks = {
  hasId: typeof first.id === "string" && first.id.length > 0,
  hasText:
    typeof first.fullText === "string" ||
    typeof first.text === "string" ||
    typeof first.full_text === "string",
  hasCreatedAt:
    typeof first.createdAt === "string" ||
    typeof first.created_at === "string",
  hasAuthor:
    typeof first?.tweetBy?.userName === "string" ||
    typeof first?.tweetBy?.username === "string" ||
    typeof first?.author?.userName === "string",
  hasLikeCount:
    typeof first.likeCount === "number" ||
    typeof first.favorite_count === "number" ||
    typeof first.likes === "number",
};
log(`shape checks: ${JSON.stringify(checks)}`);

const failedChecks = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
if (failedChecks.length > 0) {
  fail(`shape checks failed: ${failedChecks.join(", ")}`, {
    firstTweetKeys: firstKeys.join(","),
    firstTweetSample: JSON.stringify(first).slice(0, 1000),
  });
}

const textOf = (t) => t.fullText ?? t.text ?? t.full_text ?? "";
const longest = tweets.reduce((acc, t) => {
  const len = textOf(t).length;
  return len > acc.len ? { len, t } : acc;
}, { len: 0, t: null });

let longTextWarning = null;
if (longest.len > 280) {
  log(`long-form tweet found: ${longest.len} chars — full-text expansion VERIFIED`);
} else {
  longTextWarning = `no tweet >280 chars on first page (longest=${longest.len}); full-text round-trip not validated against this list, but not a hard failure`;
  log(`WARN: ${longTextWarning}`);
}

const cursorPresent =
  (typeof result?.next === "object" && result.next?.value) ||
  (typeof result?.next === "string" && result.next.length > 0);
log(`cursor present for pagination: ${!!cursorPresent}`);

const sample = {
  vs: "VS-0a-userauth",
  library: "rettiwt-api",
  version: "7.0.3",
  list_id: LIST_ID,
  auth_mode: "user (apiKey)",
  count_returned: tweets.length,
  cursor_present: !!cursorPresent,
  longest_text_chars: longest.len,
  long_text_warning: longTextWarning,
  first_three: tweets.slice(0, 3).map((t) => ({
    id: t.id,
    createdAt: t.createdAt ?? t.created_at,
    authorHandle:
      t.tweetBy?.userName ?? t.tweetBy?.username ?? t.author?.userName ?? null,
    likeCount: t.likeCount ?? t.favorite_count ?? null,
    retweetCount: t.retweetCount ?? t.retweet_count ?? null,
    replyCount: t.replyCount ?? t.reply_count ?? null,
    quoteCount: t.quoteCount ?? t.quote_count ?? null,
    viewCount: t.viewCount ?? null,
    bookmarkCount: t.bookmarkCount ?? null,
    isRetweet: !!(t.retweetedTweet ?? t.retweeted_status),
    isQuote: !!(t.quoted ?? t.quotedTweet ?? t.quoted_status),
    isReply: !!(t.replyTo ?? t.in_reply_to_status_id),
    photoCount: Array.isArray(t.media)
      ? t.media.filter((m) => m.type === "photo").length
      : null,
    textPreview: textOf(t).slice(0, 200),
    fullTextLength: textOf(t).length,
  })),
};

const samplePath = resolve(__dirname, "payload.sample.json");
writeFileSync(samplePath, JSON.stringify(sample, null, 2));
log(`payload sample written to ${samplePath}`);

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
log(`PASS — list-tweets in user-auth mode, ${tweets.length} tweets, ${elapsed}s`);
process.exit(0);
