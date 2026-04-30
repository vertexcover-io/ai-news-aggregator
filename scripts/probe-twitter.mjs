#!/usr/bin/env node
//
// Probe X (Twitter) GraphQL state used by the Twitter collector.
//
// Run when something breaks in production — prints whether bearer, queryIds, and
// cookies are still valid, and which endpoints respond. Diagnosis-only; reads
// TWITTER_COOKIES_JSON and TWITTER_BEARER from .env, hits live x.com, prints a
// report. Never writes anywhere.
//
// Usage (from repo root):
//   node scripts/probe-twitter.mjs                        # default: probe everything
//   node scripts/probe-twitter.mjs --user openai          # custom handle
//   node scripts/probe-twitter.mjs --list 1410385144528224259
//
// Symptom -> fix table is at the bottom of the printed report.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Bearer hardcoded in packages/pipeline/src/collectors/twitter.ts. Kept in sync
// manually — if this script reports it as stale, update both.
const COLLECTOR_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const args = parseArgs(process.argv.slice(2));
const USER = args.user ?? "openai";
const LIST = args.list ?? "1410385144528224259"; // "Community builders" — public, active

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith("--")) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function loadEnv() {
  const path = resolve(process.cwd(), ".env");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    fail(`could not read ${path}. Run from the repo root.`);
  }
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function fail(msg) {
  console.error(`probe-twitter: ${msg}`);
  process.exit(1);
}

function header(s) {
  console.log("\n" + "─".repeat(70) + "\n " + s + "\n" + "─".repeat(70));
}
function ok(s) { console.log("  ✓ " + s); }
function bad(s) { console.log("  ✗ " + s); }
function info(s) { console.log("    " + s); }

// ── 1. cookies ──
function checkCookies(env) {
  header("1. cookies");
  if (!env.TWITTER_COOKIES_JSON) fail("TWITTER_COOKIES_JSON not set in .env");
  let cookies;
  try {
    cookies = JSON.parse(env.TWITTER_COOKIES_JSON);
  } catch (e) {
    fail(`TWITTER_COOKIES_JSON is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(cookies)) fail("TWITTER_COOKIES_JSON must be an array");
  const required = ["auth_token", "ct0"];
  const present = new Set(cookies.map((c) => c?.name));
  for (const r of required) {
    if (!present.has(r)) bad(`required cookie "${r}" missing`);
    else ok(`${r} present`);
  }
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const ct0 = cookies.find((c) => c.name === "ct0").value;
  info(`${cookies.length} cookies, header length ${cookieStr.length}`);
  return { cookies, cookieStr, ct0 };
}

// ── 2. main.js + queryIds ──
async function fetchMainJs(cookieStr) {
  header("2. main.js & queryIds");
  const homeRes = await fetch("https://x.com/", {
    headers: { "user-agent": UA, cookie: cookieStr },
  });
  const html = await homeRes.text();
  const m = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-z0-9]+\.js/);
  if (!m) {
    bad("could not locate main.js URL on https://x.com/");
    info("X may have changed the bundle naming convention — update the regex in twitter.ts");
    fail("aborting probe");
  }
  ok(`main.js found: ${m[0]}`);

  const jsRes = await fetch(m[0], { headers: { "user-agent": UA } });
  const js = await jsRes.text();
  info(`main.js size: ${(js.length / 1024).toFixed(0)} KB`);

  const ops = ["UserByScreenName", "UserTweets", "ListLatestTweetsTimeline", "ListByRestId"];
  const ids = {};
  for (const op of ops) {
    const re1 = new RegExp(`queryId:"([a-zA-Z0-9_-]{20,})",operationName:"${op}"`);
    const re2 = new RegExp(`operationName:"${op}"[^}]{0,200}queryId:"([a-zA-Z0-9_-]{20,})"`);
    const mm = js.match(re1) ?? js.match(re2);
    if (mm) {
      ok(`${op.padEnd(28)} ${mm[1]}`);
      ids[op] = mm[1];
    } else {
      bad(`${op.padEnd(28)} NOT FOUND in main.js`);
    }
  }

  // bearer probe — find AAAA-prefix string constants
  const bearerCandidates = [...js.matchAll(/"(AAAAAAAAAAAA[A-Za-z0-9%]{60,200})"/g)]
    .map((mm) => mm[1])
    .filter((v, i, a) => a.indexOf(v) === i);
  console.log();
  if (bearerCandidates.length === 0) {
    info("bearer: no candidates via heuristic (may be obfuscated in bundle).");
    info("        Step 3 below is the authoritative check — if 401, bearer is the suspect.");
  } else {
    const matchesCollector = bearerCandidates.includes(COLLECTOR_BEARER);
    if (matchesCollector) ok(`bearer in twitter.ts matches main.js (still current)`);
    else {
      bad("bearer hardcoded in twitter.ts NOT found in main.js");
      info("X may have rotated. Candidates from main.js:");
      for (const b of bearerCandidates.slice(0, 3)) info(`  ${b.slice(0, 30)}...${b.slice(-20)}`);
      info("To override without changing source: set TWITTER_BEARER in .env");
    }
  }

  return { ids, js };
}

// ── 3. live GraphQL calls ──
const X_FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_analysis_button_from_backend: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

async function gql(bearer, ct0, cookieStr, qid, op, variables) {
  const url =
    `https://x.com/i/api/graphql/${qid}/${op}` +
    `?variables=${encodeURIComponent(JSON.stringify(variables))}` +
    `&features=${encodeURIComponent(JSON.stringify(X_FEATURES))}`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${bearer}`,
      "x-csrf-token": ct0,
      cookie: cookieStr,
      "user-agent": UA,
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": "en",
      origin: "https://x.com",
      referer: "https://x.com/",
    },
  });
  return { status: res.status, body: await res.text() };
}

async function probeEndpoints({ ids, ct0, cookieStr }) {
  header(`3. live GraphQL calls (user="${USER}", list=${LIST})`);
  if (!ids.UserByScreenName || !ids.UserTweets || !ids.ListLatestTweetsTimeline) {
    bad("skipping — missing queryIds from step 2");
    return;
  }

  const u = await gql(COLLECTOR_BEARER, ct0, cookieStr, ids.UserByScreenName, "UserByScreenName",
    { screen_name: USER, withSafetyModeUserFields: true });
  reportEndpoint("UserByScreenName", u);
  let restId;
  try { restId = JSON.parse(u.body)?.data?.user?.result?.rest_id; } catch { /* noop */ }

  if (restId) {
    const t = await gql(COLLECTOR_BEARER, ct0, cookieStr, ids.UserTweets, "UserTweets",
      { userId: restId, count: 5, includePromotedContent: false, withVoice: true, withV2Timeline: true });
    reportEndpoint("UserTweets", t);
  } else {
    bad("UserTweets — skipped (no rest_id from UserByScreenName)");
  }

  const l = await gql(COLLECTOR_BEARER, ct0, cookieStr, ids.ListLatestTweetsTimeline, "ListLatestTweetsTimeline",
    { listId: LIST, count: 5 });
  reportEndpoint("ListLatestTweetsTimeline", l);
}

function reportEndpoint(name, r) {
  if (r.status === 200) ok(`${name.padEnd(28)} 200`);
  else if (r.status === 401) {
    bad(`${name.padEnd(28)} 401  cookies expired or bearer rotated`);
    info(`body: ${r.body.slice(0, 160)}`);
  } else if (r.status === 404) {
    bad(`${name.padEnd(28)} 404  queryId stale (this is what auto-refresh would catch)`);
  } else if (r.status === 422) {
    bad(`${name.padEnd(28)} 422  feature-flag drift — body lists missing flag`);
    info(`body: ${r.body.slice(0, 240)}`);
  } else if (r.status === 429) {
    bad(`${name.padEnd(28)} 429  rate-limited — wait 15 min`);
  } else {
    bad(`${name.padEnd(28)} ${r.status}`);
    info(`body: ${r.body.slice(0, 200)}`);
  }
}

function printGuide() {
  header("symptom → fix");
  console.log(`
  401 on any endpoint        cookies expired OR bearer rotated
                             → re-export TWITTER_COOKIES_JSON, or set TWITTER_BEARER
  404 on any endpoint        queryId rotated since process started
                             → restart pipeline, or implement on-404 cache invalidation
  422 on any endpoint        new required feature flag — body names it
                             → add the flag to X_FEATURES in twitter.ts
  429                        rate-limited — back off ~15 min
  bearer mismatch in step 2  X rotated the public webapp bearer
                             → copy a candidate from the report into TWITTER_BEARER
`);
}

async function main() {
  const env = loadEnv();
  const c = checkCookies(env);
  const m = await fetchMainJs(c.cookieStr);
  await probeEndpoints({ ids: m.ids, ct0: c.ct0, cookieStr: c.cookieStr });
  printGuide();
}

main().catch((e) => {
  console.error("\nprobe-twitter: unhandled error:", e);
  process.exit(1);
});
