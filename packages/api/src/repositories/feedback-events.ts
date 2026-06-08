import { and, count, eq } from "drizzle-orm";
import { feedbackEvents } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { FeedbackEventInsert, FeedbackEventSelect } from "@newsletter/shared";

export interface FeedbackEventsRepo {
  insertEvent(insert: FeedbackEventInsert): Promise<FeedbackEventSelect>;
  /**
   * True when the subscriber already has at least one feedback event for this
   * campaign. Used to fire the Slack notification only on a subscriber's first
   * tap, so an email-client prefetch of all three links cannot spam the channel.
   */
  hasPriorEvent(subscriberId: string, campaign: string): Promise<boolean>;
}

export function createFeedbackEventsRepo(
  db: Pick<AppDb, "select" | "insert">,
): FeedbackEventsRepo {
  return {
    async insertEvent(insert: FeedbackEventInsert): Promise<FeedbackEventSelect> {
      const [row] = await db.insert(feedbackEvents).values(insert).returning();
      return row;
    },

    async hasPriorEvent(subscriberId: string, campaign: string): Promise<boolean> {
      const [row] = await db
        .select({ value: count() })
        .from(feedbackEvents)
        .where(
          and(
            eq(feedbackEvents.subscriberId, subscriberId),
            eq(feedbackEvents.campaign, campaign),
          ),
        );
      return row.value > 0;
    },
  };
}
