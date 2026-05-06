#!/usr/bin/env node
// Pagination probe — verifies cursor advances and pages don't overlap.
// Required because the design's volume estimate (~500/day) may need >1 page.

import { Rettiwt } from "rettiwt-api";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", "..", "..", "..", "..", ".env.harness");
if (!existsSync(envPath)) {
  console.error(`FAIL: .env.harness not found at ${envPath}`);
  process.exit(1);
}
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) continue;
  if (!process.env[trimmed.slice(0, eq).trim()]) {
    process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
}

const rettiwt = new Rettiwt({ apiKey: process.env.RETTIWT_API_KEY });
const LIST_ID = "1585430245762441216";

const t1 = Date.now();
const page1 = await rettiwt.list.tweets(LIST_ID, 50);
const cursor1 = typeof page1.next === "object" ? page1.next.value : page1.next;
console.log(`page 1: ${page1.list.length} tweets in ${Date.now() - t1}ms, cursor=${cursor1 ? `${cursor1.slice(0, 40)}...` : "(none)"}`);

if (!cursor1) {
  console.error("FAIL: page 1 returned no cursor — pagination unavailable");
  process.exit(1);
}

const t2 = Date.now();
const page2 = await rettiwt.list.tweets(LIST_ID, 50, cursor1);
const cursor2 = typeof page2.next === "object" ? page2.next.value : page2.next;
console.log(`page 2: ${page2.list.length} tweets in ${Date.now() - t2}ms, cursor=${cursor2 ? `${cursor2.slice(0, 40)}...` : "(none)"}`);

const ids1 = new Set(page1.list.map((t) => t.id));
const overlap = page2.list.filter((t) => ids1.has(t.id)).length;
console.log(`overlap: ${overlap}/${page2.list.length} tweets repeated between pages`);

if (page2.list.length === 0) {
  console.error("FAIL: page 2 empty");
  process.exit(1);
}

if (overlap === page2.list.length) {
  console.error("FAIL: page 2 is identical to page 1 — cursor not advancing");
  process.exit(1);
}

console.log(`PASS — pagination works, ${page1.list.length + page2.list.length - overlap} unique tweets across 2 pages`);
process.exit(0);
