import type { AppDb } from "@newsletter/shared/db";
import { subscribers, emailSends, sesEvents } from "@newsletter/shared/db";
import { and, gte, lt, eq, count } from "drizzle-orm";

export interface AnalyticsRepo {
  getMetrics(params: { from: Date; to: Date }): Promise<{
    totalSubscriptions: number;
    totalUnsubscriptions: number;
    emailsSent: number;
    bounces: number;
    complaints: number;
    opens: number;
    clicks: number;
  }>;
}

export function createAnalyticsRepo(
  db: Pick<AppDb, "select">,
  tenantId: string,
): AnalyticsRepo {
  return {
    async getMetrics({ from, to }) {
      const [
        subscriptionsResult,
        unsubscriptionsResult,
        emailsSentResult,
        bouncesResult,
        complaintsResult,
        opensResult,
        clicksResult,
      ] = await Promise.all([
        db
          .select({ value: count() })
          .from(subscribers)
          .where(and(eq(subscribers.tenantId, tenantId), gte(subscribers.subscribedAt, from), lt(subscribers.subscribedAt, to))),
        db
          .select({ value: count() })
          .from(subscribers)
          .where(and(eq(subscribers.tenantId, tenantId), gte(subscribers.unsubscribedAt, from), lt(subscribers.unsubscribedAt, to))),
        db
          .select({ value: count() })
          .from(emailSends)
          .where(and(eq(emailSends.tenantId, tenantId), gte(emailSends.sentAt, from), lt(emailSends.sentAt, to))),
        db
          .select({ value: count() })
          .from(sesEvents)
          .where(and(eq(sesEvents.tenantId, tenantId), eq(sesEvents.eventType, "bounce"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))),
        db
          .select({ value: count() })
          .from(sesEvents)
          .where(and(eq(sesEvents.tenantId, tenantId), eq(sesEvents.eventType, "complaint"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))),
        db
          .select({ value: count() })
          .from(sesEvents)
          .where(and(eq(sesEvents.tenantId, tenantId), eq(sesEvents.eventType, "open"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))),
        db
          .select({ value: count() })
          .from(sesEvents)
          .where(and(eq(sesEvents.tenantId, tenantId), eq(sesEvents.eventType, "click"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))),
      ]);

      return {
        totalSubscriptions: subscriptionsResult[0]?.value ?? 0,
        totalUnsubscriptions: unsubscriptionsResult[0]?.value ?? 0,
        emailsSent: emailsSentResult[0]?.value ?? 0,
        bounces: bouncesResult[0]?.value ?? 0,
        complaints: complaintsResult[0]?.value ?? 0,
        opens: opensResult[0]?.value ?? 0,
        clicks: clicksResult[0]?.value ?? 0,
      };
    },
  };
}
