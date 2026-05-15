#!/usr/bin/env node
// Live probe: verify rettiwt-api 7.0.3 returns the `quoted` field on quote tweets
// with the documented ITweet shape.
//
// Strategy: scan multiple pages of a public list (the same one VS-0a uses) until
// we find a tweet whose `quoted` is populated. Then assert the inner shape
// matches the fields we plan to extract: id, fullText, tweetBy.userName,
// createdAt, media[]?.
//
// Auth: tries RETTIWT_API_KEY from env if present, otherwise falls back to
// guest mode.
//
// Exits 0 if a quote tweet is found AND shape checks pass.
// Exits 2 if no quote tweet found within MAX_PAGES (test indeterminate — not a
// library failure; the implementation can still proceed).
// Exits 1 on any hard error or shape mismatch.

import { Rettiwt } from "rettiwt-api";
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Same list used by add-twitter-x-collector VS-0a probe — known-public, high-volume,
// reliable for repeatable probes.
const LIST_ID = "1585430245762441216";
const TIMEOUT_MS = 30_000;
const PAGE_COUNT = 40;
const MAX_PAGES = 5;

// Load .env from worktree root for RETTIWT_API_KEY if present.
try {
  const envPath = resolve(__dirname, "../../../../.env");
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // ignore — guest mode still works
}

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
    timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const apiKey = process.env.RETTIWT_API_KEY;
log(`auth mode: ${apiKey ? "user (RETTIWT_API_KEY present)" : "guest"}`);
const rettiwt = apiKey ? new Rettiwt({ apiKey }) : new Rettiwt();

let cursor;
let quoteTweet = null;
let outerEnvelope = null;
let pagesScanned = 0;
let totalScanned = 0;

for (let page = 0; page < MAX_PAGES; page++) {
  log(`page ${page + 1}: list.tweets("${LIST_ID}", ${PAGE_COUNT}${cursor ? `, "${cursor.slice(0, 16)}..."` : ""})`);
  let result;
  try {
    result = await withTimeout(
      rettiwt.list.tweets(LIST_ID, PAGE_COUNT, cursor),
      TIMEOUT_MS,
    );
  } catch (err) {
    fail(`list.tweets threw on page ${page + 1}: ${err?.message ?? err}`, {
      name: err?.name,
      status: err?.response?.status,
    });
  }
  pagesScanned++;
  const tweets = Array.isArray(result?.list) ? result.list : [];
  totalScanned += tweets.length;
  log(`  returned ${tweets.length} tweets (running total: ${totalScanned})`);

  for (const t of tweets) {
    // Direct quote
    if (t?.quoted && typeof t.quoted === "object") {
      quoteTweet = t.quoted;
      outerEnvelope = t;
      log(`  found direct quote: outer=${t.id} → quoted=${t.quoted.id}`);
      break;
    }
    // Retweet of a quote (nested case — design doc covers this)
    if (t?.retweetedTweet?.quoted && typeof t.retweetedTweet.quoted === "object") {
      quoteTweet = t.retweetedTweet.quoted;
      outerEnvelope = t;
      log(`  found retweet-of-quote: outer=${t.id} → retweeted=${t.retweetedTweet.id} → quoted=${t.retweetedTweet.quoted.id}`);
      break;
    }
  }
  if (quoteTweet) break;

  const next = result?.next;
  cursor = typeof next === "string" ? next : next?.value;
  if (!cursor) {
    log(`  no more pages (cursor exhausted)`);
    break;
  }
}

if (!quoteTweet) {
  console.error(`INDETERMINATE: no quote-tweet seen in ${pagesScanned} page(s) (${totalScanned} tweets).`);
  console.error(`This is not a library failure — quote-tweets are sparse in this list.`);
  console.error(`The ITweet.quoted field is documented at:`);
  console.error(`  node_modules/.pnpm/rettiwt-api@7.0.3/node_modules/rettiwt-api/dist/types/data/Tweet.d.ts:30`);
  console.error(`  /** The tweet which is quoted in the tweet. */`);
  console.error(`  quoted?: ITweet;`);
  process.exit(2);
}

// Shape assertions on the quoted inner tweet — these are the fields the design
// doc says we extract.
const required = {
  "quoted.id (string)": typeof quoteTweet.id === "string" && quoteTweet.id.length > 0,
  "quoted.fullText (string)": typeof quoteTweet.fullText === "string",
  "quoted.tweetBy.userName (string)":
    typeof quoteTweet?.tweetBy?.userName === "string" && quoteTweet.tweetBy.userName.length > 0,
  "quoted.createdAt (string)": typeof quoteTweet.createdAt === "string",
};
const optional = {
  "quoted.media (array if present)": quoteTweet.media === undefined || Array.isArray(quoteTweet.media),
  "quoted.entities.urls (array if present)":
    quoteTweet.entities === undefined || Array.isArray(quoteTweet.entities?.urls),
};

log("required field checks:");
for (const [k, v] of Object.entries(required)) log(`  ${v ? "PASS" : "FAIL"}  ${k}`);
log("optional field checks:");
for (const [k, v] of Object.entries(optional)) log(`  ${v ? "PASS" : "FAIL"}  ${k}`);

const failedRequired = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
const failedOptional = Object.entries(optional).filter(([, v]) => !v).map(([k]) => k);
if (failedRequired.length > 0 || failedOptional.length > 0) {
  fail(`shape mismatch`, {
    failedRequired: failedRequired.join(", ") || "(none)",
    failedOptional: failedOptional.join(", ") || "(none)",
    actualQuotedKeys: Object.keys(quoteTweet).join(","),
    sample: JSON.stringify(quoteTweet).slice(0, 600),
  });
}

const sample = {
  vs: "VS-0",
  library: "rettiwt-api",
  version: "7.0.3",
  list_id: LIST_ID,
  pages_scanned: pagesScanned,
  total_tweets_scanned: totalScanned,
  case: outerEnvelope.retweetedTweet ? "retweet-of-quote" : "direct-quote",
  outer: {
    id: outerEnvelope.id,
    authorHandle: outerEnvelope.tweetBy?.userName ?? null,
    isRetweet: !!outerEnvelope.retweetedTweet,
    isQuote: !!outerEnvelope.quoted,
  },
  quoted: {
    id: quoteTweet.id,
    authorHandle: quoteTweet.tweetBy.userName,
    createdAt: quoteTweet.createdAt,
    fullTextLength: quoteTweet.fullText.length,
    textPreview: quoteTweet.fullText.slice(0, 200),
    mediaCount: Array.isArray(quoteTweet.media) ? quoteTweet.media.length : 0,
    entityUrlCount: Array.isArray(quoteTweet?.entities?.urls)
      ? quoteTweet.entities.urls.length
      : 0,
  },
};

const samplePath = resolve(__dirname, "payload.sample.json");
writeFileSync(samplePath, JSON.stringify(sample, null, 2));
log(`payload sample written to ${samplePath}`);

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
log(`PASS — quoted field shape verified in ${elapsed}s`);
process.exit(0);
