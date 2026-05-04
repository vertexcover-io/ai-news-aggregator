#!/usr/bin/env node
// VS-0a-user-timeline: Probes rettiwt.user.details(handle) → numeric ID
// resolution AND rettiwt.user.timeline(id) tweet fetch, both in user-auth mode.
//
// This validates the second collection path added by user feedback after the
// initial probe: pulling tweets from individual @handles, in addition to
// list timelines. Same RETTIWT_API_KEY as VS-0a-userauth.

import { Rettiwt } from "rettiwt-api";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 30_000;

// Two well-known handles for the smoke test:
//   - jack      → user ID 12   (Jack Dorsey, oldest stable account)
//   - sama      → fresh content; verifies long-text + media on a real account
const TEST_HANDLES = ["jack", "sama"];

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

const envPath = resolve(__dirname, "..", "..", "..", "..", "..", ".env.harness");
if (!existsSync(envPath)) fail(`.env.harness not found at ${envPath}`);
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) continue;
  const k = trimmed.slice(0, eq).trim();
  if (!process.env[k]) process.env[k] = trimmed.slice(eq + 1).trim();
}

const apiKey = process.env.RETTIWT_API_KEY;
if (!apiKey) fail("RETTIWT_API_KEY missing");
log(`apiKey loaded (length=${apiKey.length})`);

const rettiwt = new Rettiwt({ apiKey });

// Step 1: handle -> numeric ID resolution
const resolved = [];
for (const handle of TEST_HANDLES) {
  log(`resolving @${handle} via rettiwt.user.details(${handle})`);
  let user;
  try {
    user = await withTimeout(rettiwt.user.details(handle), TIMEOUT_MS);
  } catch (err) {
    fail(`user.details("${handle}") threw: ${err?.message ?? err}`, {
      stack: (err?.stack ?? "").split("\n").slice(0, 4).join(" | "),
    });
  }
  if (!user) fail(`user.details("${handle}") returned undefined`);
  if (!user.id || typeof user.id !== "string") {
    fail(`user.details("${handle}") returned no id`, {
      shape: JSON.stringify(Object.keys(user)),
    });
  }
  log(`  -> id=${user.id}, userName=${user.userName}, fullName=${user.fullName}`);
  resolved.push({
    handle,
    userId: user.id,
    userName: user.userName,
    fullName: user.fullName,
  });
}

// Step 2: user.timeline(numericId) fetches tweets
const timelineResults = [];
for (const u of resolved) {
  log(`calling rettiwt.user.timeline("${u.userId}", 10) for @${u.handle}`);
  let result;
  try {
    result = await withTimeout(rettiwt.user.timeline(u.userId, 10), TIMEOUT_MS);
  } catch (err) {
    fail(`user.timeline("${u.userId}") threw: ${err?.message ?? err}`, {
      handle: u.handle,
      stack: (err?.stack ?? "").split("\n").slice(0, 4).join(" | "),
    });
  }
  const tweets = Array.isArray(result?.list) ? result.list : null;
  if (!Array.isArray(tweets)) {
    fail(`user.timeline result missing .list array`, {
      shape: JSON.stringify(Object.keys(result ?? {})),
      sample: JSON.stringify(result).slice(0, 400),
    });
  }
  log(`  -> ${tweets.length} tweets, cursor=${result?.next?.value ? "yes" : "no"}`);
  if (tweets.length === 0) {
    log(`  WARN: 0 tweets for @${u.handle} — account may be quiet, not a hard failure`);
  } else {
    const first = tweets[0];
    const checks = {
      hasId: typeof first.id === "string",
      hasText: typeof first.fullText === "string" || typeof first.text === "string",
      hasCreatedAt: typeof first.createdAt === "string",
      hasAuthor: typeof first?.tweetBy?.userName === "string",
      hasLikeCount: typeof first.likeCount === "number",
    };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (failed.length) {
      fail(`shape checks failed for @${u.handle}: ${failed.join(", ")}`, {
        firstTweetKeys: Object.keys(first).join(","),
        sample: JSON.stringify(first).slice(0, 600),
      });
    }
    log(`  shape: ${JSON.stringify(checks)}`);
  }
  timelineResults.push({
    handle: u.handle,
    userId: u.userId,
    userName: u.userName,
    tweetCount: tweets.length,
    cursorPresent: !!result?.next?.value,
    firstTweetPreview: tweets[0]
      ? {
          id: tweets[0].id,
          createdAt: tweets[0].createdAt,
          authorHandle: tweets[0].tweetBy?.userName,
          textPreview: (tweets[0].fullText ?? tweets[0].text ?? "").slice(0, 120),
          fullTextLength: (tweets[0].fullText ?? tweets[0].text ?? "").length,
        }
      : null,
  });
}

const samplePath = resolve(__dirname, "payload-user-timeline.sample.json");
writeFileSync(
  samplePath,
  JSON.stringify(
    {
      vs: "VS-0a-user-timeline",
      library: "rettiwt-api",
      version: "7.0.3",
      auth_mode: "user (apiKey)",
      handles_resolved: resolved.length,
      timelines_fetched: timelineResults.length,
      results: timelineResults,
    },
    null,
    2,
  ),
);

log(`sample written to ${samplePath}`);
log(`PASS — handle->id resolution + user.timeline() in user-auth mode (${(Date.now() - t0) / 1000}s)`);
process.exit(0);
