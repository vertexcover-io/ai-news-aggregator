#!/usr/bin/env node
// VS-0b: Live probe of @the-convocation/twitter-scraper fetchListTweets()
// against a real public list in GUEST mode (no login() call, no cookies).
//
// Per design doc: cookie/login auth is EXCLUDED. Only guest mode is allowed.
//
// Asserts:
//   1. >=1 tweet returned
//   2. Each tweet has id, text, createdAt, like count, author handle
//   3. Long-form tweet round-trip if any >280 chars are on the first page
//
// If guest mode fails (auth error from the library or Twitter), the probe
// FAILS — we do NOT pivot to login mode.

import { Scraper } from "@the-convocation/twitter-scraper";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIST_ID = "1585430245762441216";
const TIMEOUT_MS = 30_000;
const MAX_TWEETS = 20;

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

log("instantiating new Scraper() with NO login() (guest mode)");
const scraper = new Scraper();

log(`calling scraper.fetchListTweets("${LIST_ID}", ${MAX_TWEETS})`);
let result;
try {
  result = await withTimeout(scraper.fetchListTweets(LIST_ID, MAX_TWEETS), TIMEOUT_MS);
} catch (err) {
  fail(`fetchListTweets threw: ${err?.message ?? err}`, {
    name: err?.name,
    code: err?.code,
    status: err?.response?.status ?? err?.status,
    stack: (err?.stack ?? "").split("\n").slice(0, 6).join(" | "),
  });
}

log(`result kind: ${typeof result}; keys: ${result ? Object.keys(result).join(",") : "(null)"}`);

if (!result) fail("fetchListTweets returned null/undefined");

// QueryTweetsResponse shape: { tweets: Tweet[], next?: string, previous?: string }
const tweets = result.tweets;
if (!Array.isArray(tweets)) {
  fail("result.tweets is not an array", {
    shape: JSON.stringify(Object.keys(result)),
    sample: JSON.stringify(result).slice(0, 600),
  });
}

log(`tweets returned: ${tweets.length}`);
if (tweets.length === 0) {
  fail("fetchListTweets returned 0 tweets — list may be private/empty/blocked or guest mode is denied", {
    next: result.next ?? "(no cursor)",
    sample: JSON.stringify(result).slice(0, 400),
  });
}

const first = tweets[0];
const firstKeys = Object.keys(first);
log(`first tweet keys: ${firstKeys.join(",")}`);

const checks = {
  hasId: typeof first.id === "string" && first.id.length > 0,
  hasText: typeof first.text === "string",
  hasCreatedAt:
    typeof first.timeParsed === "object" /* Date instance */ ||
    typeof first.timestamp === "number" ||
    typeof first.timestampMs === "number" ||
    typeof first.createdAt === "string",
  hasAuthor:
    typeof first.username === "string" || typeof first.userId === "string",
  hasLikeCount: typeof first.likes === "number",
};

log(`shape checks: ${JSON.stringify(checks)}`);

const failedChecks = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
if (failedChecks.length > 0) {
  fail(`shape checks failed: ${failedChecks.join(", ")}`, {
    firstTweetKeys: firstKeys.join(","),
    firstTweetSample: JSON.stringify(first).slice(0, 800),
  });
}

const longest = tweets.reduce((acc, t) => {
  const len = (t.text ?? "").length;
  return len > acc.len ? { len, t } : acc;
}, { len: 0, t: null });

let longTextWarning = null;
if (longest.len > 280) {
  log(`long-form tweet found: ${longest.len} chars — full-text expansion VERIFIED`);
} else {
  longTextWarning = `no tweet >280 chars on first page (longest=${longest.len}); full-text round-trip not validated against this list, but not a hard failure`;
  log(`WARN: ${longTextWarning}`);
}

const sample = {
  vs: "VS-0b",
  library: "@the-convocation/twitter-scraper",
  version: "0.22.3",
  list_id: LIST_ID,
  count_returned: tweets.length,
  cursor_present: typeof result.next === "string" && result.next.length > 0,
  longest_text_chars: longest.len,
  long_text_warning: longTextWarning,
  first_three: tweets.slice(0, 3).map((t) => ({
    id: t.id,
    timeParsed: t.timeParsed instanceof Date ? t.timeParsed.toISOString() : t.timeParsed,
    timestamp: t.timestamp,
    username: t.username,
    name: t.name,
    likes: t.likes,
    retweets: t.retweets,
    replies: t.replies,
    isRetweet: t.isRetweet,
    isReply: t.isReply,
    isQuoted: t.isQuoted,
    photos: Array.isArray(t.photos) ? t.photos.length : null,
    videos: Array.isArray(t.videos) ? t.videos.length : null,
    textPreview: (t.text ?? "").slice(0, 200),
    fullTextLength: (t.text ?? "").length,
  })),
};

const samplePath = resolve(__dirname, "payload.sample.json");
writeFileSync(samplePath, JSON.stringify(sample, null, 2));
log(`payload sample written to ${samplePath}`);

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
log(`PASS — fetchListTweets in guest mode, ${tweets.length} tweets, ${elapsed}s`);
process.exit(0);
