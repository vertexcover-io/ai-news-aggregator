import { eq } from "drizzle-orm";
import { userSettings } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { UserSettings } from "@newsletter/shared";

export interface UserSettingsRepo {
  get(): Promise<UserSettings | null>;
}

export function createUserSettingsRepo(
  db: Pick<AppDb, "select">,
): UserSettingsRepo {
  return {
    async get(): Promise<UserSettings | null> {
      const rows = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.singleton, true))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        id: row.id,
        topN: row.topN,
        halfLifeHours: row.halfLifeHours,
        hnConfig: row.hnConfig,
        redditConfig: row.redditConfig,
        webConfig: row.webConfig,
        twitterConfig: row.twitterConfig ?? null,
        scheduleTime: row.scheduleTime,
        scheduleTimezone: row.scheduleTimezone,
        scheduleEnabled: row.scheduleEnabled,
        updatedAt:
          row.updatedAt instanceof Date
            ? row.updatedAt.toISOString()
            : String(row.updatedAt),
      };
    },
  };
}
