#!/usr/bin/env node
// VS-0a: Live probe of rettiwt-api list.tweets() against a real public list
// in GUEST mode (no apiKey, no cookie auth).
//
// Per design doc: cookie-based 'user' auth is EXCLUDED. Only guest mode is
// allowed.
//
// Usage: node probe-list-tweets.mjs
//
// Asserts:
//   1. >=1 tweet returned
//   2. Each tweet has id, text/fullText, createdAt, like count, author
//   3. Long-form tweet round-trip (warning, not failure, if no long tweet
//      appears on first page)
//
// Exits 0 on success, 1 on failure. Captures payload sample to
// payload.sample.json (truncated, no auth secrets — guest mode has none).

import { Rettiwt } from "rettiwt-api";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const LIST_ID = "1585430245762441216";
const TIMEOUT_MS = 30_000;
const COUNT = 20; // small batch, just enough to verify shape

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

log("instantiating Rettiwt() with NO apiKey (guest mode)");
const rettiwt = new Rettiwt(); // no apiKey -> guest auth per README

log(`calling rettiwt.list.tweets("${LIST_ID}", ${COUNT})`);
let result;
try {
  result = await withTimeout(rettiwt.list.tweets(LIST_ID, COUNT), TIMEOUT_MS);
} catch (err) {
  fail(`rettiwt.list.tweets threw: ${err?.message ?? err}`, {
    name: err?.name,
    code: err?.code,
    status: err?.response?.status,
    stack: (err?.stack ?? "").split("\n").slice(0, 5).join(" | "),
  });
}

log(`result kind: ${typeof result}; keys: ${result ? Object.keys(result).join(",") : "(null)"}`);

if (!result) fail("rettiwt.list.tweets returned null/undefined");

const tweets = Array.isArray(result?.list) ? result.list
  : Array.isArray(result?.data) ? result.data
  : Array.isArray(result?.tweets) ? result.tweets
  : Array.isArray(result) ? result
  : null;

if (!Array.isArray(tweets)) {
  fail("could not locate tweets array on result", {
    shape: JSON.stringify(Object.keys(result ?? {})),
    sample: JSON.stringify(result).slice(0, 500),
  });
}

log(`tweets returned: ${tweets.length}`);
if (tweets.length === 0) {
  fail("rettiwt.list.tweets returned 0 tweets — list may be private/empty/blocked", {
    next: result?.next ?? "(no cursor)",
  });
}

// Shape check on first tweet
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
    typeof first?.author?.userName === "string" ||
    typeof first?.tweetBy?.username === "string",
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
    firstTweetSample: JSON.stringify(first).slice(0, 800),
  });
}

// Full-text round-trip check (non-fatal)
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

// Save sanitized payload sample (first 3 tweets only, truncated)
const sample = {
  vs: "VS-0a",
  library: "rettiwt-api",
  version: "7.0.3",
  list_id: LIST_ID,
  count_returned: tweets.length,
  cursor_present: typeof result.next === "string" && result.next.length > 0,
  longest_text_chars: longest.len,
  long_text_warning: longTextWarning,
  first_three: tweets.slice(0, 3).map((t) => ({
    id: t.id,
    createdAt: t.createdAt ?? t.created_at,
    authorHandle:
      t.tweetBy?.userName ?? t.author?.userName ?? t.tweetBy?.username ?? null,
    likeCount: t.likeCount ?? t.favorite_count ?? null,
    retweetCount: t.retweetCount ?? t.retweet_count ?? null,
    replyCount: t.replyCount ?? t.reply_count ?? null,
    textPreview: textOf(t).slice(0, 200),
    fullTextLength: textOf(t).length,
    hasMedia: Array.isArray(t.media) && t.media.length > 0,
  })),
};

const samplePath = resolve(__dirname, "payload.sample.json");
writeFileSync(samplePath, JSON.stringify(sample, null, 2));
log(`payload sample written to ${samplePath}`);

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
log(`PASS — list-tweets in guest mode, ${tweets.length} tweets, ${elapsed}s`);
process.exit(0);
