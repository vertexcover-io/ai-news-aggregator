/**
 * End-to-end functional verification:
 *
 * 1. Insert a test subscriber (status=pending) with a fresh confirm token.
 * 2. Hit GET /api/confirm?token=<token> on a running api server.
 * 3. Assert: subscriber.status -> "confirmed".
 * 4. Assert: BullMQ "send-newsletter" queue has a new job with runId pointing at
 *    the most recent reviewed archive in the DB.
 * 5. Cleanup: delete the test subscriber and the enqueued job.
 */
// Env is provided by the shell (loaded via `set -a && source .env`).
import { Queue } from "bullmq";
import { createRedisConnection } from "@newsletter/shared/redis";
import { getDb } from "@newsletter/shared";
import { createSubscribersRepo } from "../src/repositories/subscribers.ts";
import { createRunArchivesRepo } from "../src/repositories/run-archives.ts";
import { issueSubscriberToken } from "../src/lib/subscriber-token.ts";

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) throw new Error("SESSION_SECRET required");

const apiUrl = process.env.API_BASE_URL ?? "http://localhost:8080";

const db = getDb();
const subscribersRepo = createSubscribersRepo(db);
const archivesRepo = createRunArchivesRepo(db);

const testEmail = `e2e-confirm-${Date.now()}@example.com`;

console.log("=== confirm-flow-e2e ===");
console.log("apiUrl:", apiUrl);
console.log("test email:", testEmail);

// 1. Find expected most-recent reviewed archive
const expected = await archivesRepo.findMostRecentReviewed();
if (!expected) throw new Error("FAIL: no reviewed archive in DB to send");
console.log("expected runId from repo.findMostRecentReviewed():", expected.id);

// 2. Insert test subscriber
const sub = await subscribersRepo.create({
  email: testEmail,
  status: "pending",
  confirmToken: "placeholder",
  confirmTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
});
console.log("subscriber inserted:", sub.id);

const token = issueSubscriberToken(sub.id, "confirm", sessionSecret);

// 3. Snapshot queue state BEFORE
const queue = new Queue("send-newsletter", { connection: createRedisConnection() });
const beforeWaiting = await queue.getWaitingCount();
const beforeJobs = await queue.getJobs(["waiting", "active", "delayed", "completed"], 0, -1);
console.log("queue waiting count BEFORE:", beforeWaiting);
console.log("queue total jobs BEFORE:", beforeJobs.length);

// 4. Hit /api/confirm
const confirmUrl = `${apiUrl}/api/confirm?token=${encodeURIComponent(token)}`;
const res = await fetch(confirmUrl, { redirect: "manual" });
console.log("HTTP status:", res.status);
console.log("HTTP location:", res.headers.get("location"));
if (res.status !== 302) throw new Error(`FAIL: expected 302, got ${res.status}`);

// 5. Assert subscriber confirmed
await new Promise((r) => setTimeout(r, 250));
const after = await subscribersRepo.findByEmail(testEmail);
if (!after || after.status !== "confirmed")
  throw new Error(`FAIL: subscriber status is ${after?.status ?? "missing"}, expected confirmed`);
console.log("subscriber status AFTER:", after.status);

// 6. Assert send-newsletter job enqueued
const afterJobs = await queue.getJobs(["waiting", "active", "delayed", "completed"], 0, -1);
console.log("queue total jobs AFTER:", afterJobs.length);

const ourJobId = `send-${expected.id}-${sub.id}`;
const ourJob = afterJobs.find((j) => j.id === ourJobId);
if (!ourJob)
  throw new Error(`FAIL: expected BullMQ job id "${ourJobId}" not found in queue`);
console.log("found job id:", ourJob.id);
console.log("job name:", ourJob.name);
console.log("job data:", JSON.stringify(ourJob.data));
if (ourJob.data.runId !== expected.id)
  throw new Error(`FAIL: job runId=${ourJob.data.runId}, expected ${expected.id}`);
if (!ourJob.data.subscriberIds?.includes(sub.id))
  throw new Error(`FAIL: subscriberIds doesn't contain ${sub.id}`);

console.log("\n✓ PASS: confirm flow enqueued send-newsletter job for the most-recent reviewed archive");

// 7. Cleanup
await ourJob.remove();
console.log("cleanup: removed enqueued job");
await db.execute(`DELETE FROM subscribers WHERE id = '${sub.id}'` as never);
console.log("cleanup: deleted subscriber");

await queue.close();
console.log("done");
process.exit(0);
