import { eq } from "drizzle-orm";
import { userSettings } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { UserSettings } from "@newsletter/shared";
import type { EncryptedBlob } from "@newsletter/shared/services/credential-cipher";

export interface UserSettingsRepo {
  get(): Promise<UserSettings | null>;
}

export interface TenantNotificationSettings {
  notificationEmail: string | null;
  slackWebhookEncrypted: EncryptedBlob | null;
}

export interface NotificationSettingsRepo {
  get(): Promise<TenantNotificationSettings | null>;
}

export function createNotificationSettingsRepo(
  db: Pick<AppDb, "select">,
  tenantId: string,
): NotificationSettingsRepo {
  return {
    async get(): Promise<TenantNotificationSettings | null> {
      const rows = await db
        .select({
          notificationEmail: userSettings.notificationEmail,
          slackWebhookEncrypted: userSettings.slackWebhookEncrypted,
        })
        .from(userSettings)
        .where(eq(userSettings.tenantId, tenantId))
        .limit(1);
      if (rows.length === 0) return null;
      return {
        notificationEmail: rows[0].notificationEmail ?? null,
        slackWebhookEncrypted: rows[0].slackWebhookEncrypted ?? null,
      };
    },
  };
}

export function createUserSettingsRepo(
  db: Pick<AppDb, "select">,
  tenantId: string,
): UserSettingsRepo {
  return {
    async get(): Promise<UserSettings | null> {
      const rows = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.tenantId, tenantId))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        id: row.id,
        topN: row.topN,
        halfLifeHours: row.halfLifeHours,
        hnEnabled: row.hnEnabled,
        hnConfig: row.hnConfig,
        redditEnabled: row.redditEnabled,
        redditConfig: row.redditConfig,
        webEnabled: row.webEnabled,
        webConfig: row.webConfig,
        twitterEnabled: row.twitterEnabled,
        twitterConfig: row.twitterConfig,
        webSearchEnabled: row.webSearchEnabled,
        webSearchConfig: row.webSearchConfig,
        posthogEnabled: row.posthogEnabled,
        posthogProjectToken: row.posthogProjectToken ?? null,
        posthogHost: row.posthogHost ?? null,
        scheduleTime: row.pipelineTime,
        pipelineTime: row.pipelineTime,
        emailTime: row.emailTime,
        linkedinTime: row.linkedinTime,
        twitterTime: row.twitterTime,
        scheduleTimezone: row.scheduleTimezone,
        scheduleEnabled: row.scheduleEnabled,
        emailEnabled: row.emailEnabled,
        linkedinEnabled: row.linkedinEnabled,
        twitterPostEnabled: row.twitterPostEnabled,
        autoReview: row.autoReview,
        rankingPrompt: row.rankingPrompt,
        shortlistPrompt: row.shortlistPrompt,
        shortlistSize: row.shortlistSize,
        updatedAt:
          row.updatedAt instanceof Date
            ? row.updatedAt.toISOString()
            : String(row.updatedAt),
      };
    },
  };
}
