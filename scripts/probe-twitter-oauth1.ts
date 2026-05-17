#!/usr/bin/env tsx
/**
 * Probe X / Twitter OAuth 1.0a auto-post credentials without posting.
 *
 * Usage: pnpm tsx scripts/probe-twitter-oauth1.ts
 *
 * Reads TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, and
 * TWITTER_ACCESS_TOKEN_SECRET from .env.
 */
import { resolve } from "node:path";
import { config as dotenv } from "dotenv";

import { createTwitterApiClient } from "../packages/pipeline/src/social/twitter/api-client.js";

dotenv({ path: resolve(process.cwd(), ".env") });

const credentials = {
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
};

const missing = Object.entries(credentials)
  .filter(([, value]) => value === undefined || value === "")
  .map(([key]) => key);

if (missing.length > 0) {
  console.error(`Missing X OAuth1 env vars: ${missing.join(", ")}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const client = createTwitterApiClient({
    appKey: credentials.appKey ?? "",
    appSecret: credentials.appSecret ?? "",
    accessToken: credentials.accessToken ?? "",
    accessSecret: credentials.accessSecret ?? "",
  });
  const result = await client.validateCredentials();

  if (!result.ok) {
    console.error(
      `X OAuth1 credential validation failed: ${result.status} ${result.body}`,
    );
    process.exit(1);
  }

  console.log("X OAuth1 credential validation passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
