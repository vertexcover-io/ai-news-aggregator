import type { AppDb, TenantScope } from "@newsletter/shared/db";
import { subscribers, emailSends, sesEvents, tenantScoped } from "@newsletter/shared/db";
import { gte, lt, eq, count } from "drizzle-orm";

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
  ctx?: TenantScope,
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
          .where(tenantScoped(subscribers.tenantId, ctx, gte(subscribers.subscribedAt, from), lt(subscribers.subscribedAt, to))),
        db
          .select({ value: count() })
          .from(subscribers)
          .where(tenantScoped(subscribers.tenantId, ctx, gte(subscribers.unsubscribedAt, from), lt(subscribers.unsubscribedAt, to))),
        db
          .select({ value: count() })
          .from(emailSends)
          .where(tenantScoped(emailSends.tenantId, ctx, gte(emailSends.sentAt, from), lt(emailSends.sentAt, to))),
        db
          .select({ value: count() })
          .from(sesEvents)
          .where(tenantScoped(sesEvents.tenantId, ctx, eq(sesEvents.eventType, "bounce"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))),
        db
          .select({ value: count() })
          .from(sesEvents)
          .where(tenantScoped(sesEvents.tenantId, ctx, eq(sesEvents.eventType, "complaint"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))),
        db
          .select({ value: count() })
          .from(sesEvents)
          .where(tenantScoped(sesEvents.tenantId, ctx, eq(sesEvents.eventType, "open"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))),
        db
          .select({ value: count() })
          .from(sesEvents)
          .where(tenantScoped(sesEvents.tenantId, ctx, eq(sesEvents.eventType, "click"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))),
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
