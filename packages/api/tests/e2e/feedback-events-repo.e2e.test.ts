/**
 * e2e: feedback-events repository against the real DB.
 * Verifies the 0038 migration (feedback_events table) and the append-only
 * insert + first-tap detection SQL used by the GET /api/feedback route.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const { getDb } = await import("@newsletter/shared/db");
const { createFeedbackEventsRepo } = await import("@api/repositories/feedback-events.js");
const { createSubscribersRepo } = await import("@api/repositories/subscribers.js");

const db = getDb();
const repo = createFeedbackEventsRepo(db);
const subscribersRepo = createSubscribersRepo(db);

const CAMPAIGN = "e2e-feedback-events-test";
const EMAIL = "feedback-events-repo-e2e@example.com";

async function wipe(): Promise<void> {
  await db.execute(sql`DELETE FROM feedback_events WHERE campaign = ${CAMPAIGN}`);
  await db.execute(sql`DELETE FROM subscribers WHERE email = ${EMAIL}`);
}

beforeAll(wipe);
afterAll(wipe);
beforeEach(wipe);

async function seedSubscriber(): Promise<string> {
  const row = await subscribersRepo.create({ email: EMAIL, status: "confirmed" });
  return row.id;
}

describe("createFeedbackEventsRepo (e2e)", () => {
  it("starts with no prior event, then reports one after the first insert", async () => {
    const subscriberId = await seedSubscriber();

    expect(await repo.hasPriorEvent(subscriberId, CAMPAIGN)).toBe(false);

    const row = await repo.insertEvent({
      subscriberId,
      campaign: CAMPAIGN,
      rating: "love",
      userAgent: "vitest",
      ip: "127.0.0.1",
    });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(row.rating).toBe("love");
    expect(row.createdAt).toBeInstanceOf(Date);

    expect(await repo.hasPriorEvent(subscriberId, CAMPAIGN)).toBe(true);
  });

  it("is append-only — repeat taps add rows rather than overwriting", async () => {
    const subscriberId = await seedSubscriber();

    await repo.insertEvent({ subscriberId, campaign: CAMPAIGN, rating: "love", userAgent: null, ip: null });
    await repo.insertEvent({ subscriberId, campaign: CAMPAIGN, rating: "nah", userAgent: null, ip: null });

    const rows = await db.execute<{ c: number }>(
      sql`SELECT count(*)::int AS c FROM feedback_events WHERE campaign = ${CAMPAIGN}`,
    );
    expect(rows[0].c).toBe(2);
  });

  it("scopes prior-event detection to the given campaign", async () => {
    const subscriberId = await seedSubscriber();
    await repo.insertEvent({ subscriberId, campaign: CAMPAIGN, rating: "meh", userAgent: null, ip: null });

    expect(await repo.hasPriorEvent(subscriberId, "some-other-campaign")).toBe(false);
  });
});
