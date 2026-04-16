import { eq } from "drizzle-orm";
import { userSettings } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { UserSettings } from "@newsletter/shared";

export type UserSettingsUpsertInput = Omit<UserSettings, "id" | "updatedAt">;

export interface UserSettingsRepo {
  get(): Promise<UserSettings | null>;
  upsert(input: UserSettingsUpsertInput): Promise<UserSettings>;
}

function toDomain(
  row: typeof userSettings.$inferSelect,
): UserSettings {
  return {
    id: row.id,
    topN: row.topN,
    halfLifeHours: row.halfLifeHours,
    hnConfig: row.hnConfig ?? null,
    redditConfig: row.redditConfig ?? null,
    webConfig: row.webConfig ?? null,
    scheduleTime: row.scheduleTime,
    scheduleTimezone: row.scheduleTimezone,
    scheduleEnabled: row.scheduleEnabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createUserSettingsRepo(
  db: Pick<AppDb, "select" | "insert">,
): UserSettingsRepo {
  return {
    async get(): Promise<UserSettings | null> {
      const rows = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.singleton, true))
        .limit(1);
      if (rows.length === 0) return null;
      return toDomain(rows[0]);
    },

    async upsert(input: UserSettingsUpsertInput): Promise<UserSettings> {
      const now = new Date();
      const [row] = await db
        .insert(userSettings)
        .values({
          singleton: true,
          topN: input.topN,
          halfLifeHours: input.halfLifeHours,
          hnConfig: input.hnConfig ?? null,
          redditConfig: input.redditConfig ?? null,
          webConfig: input.webConfig ?? null,
          scheduleTime: input.scheduleTime,
          scheduleTimezone: input.scheduleTimezone,
          scheduleEnabled: input.scheduleEnabled,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userSettings.singleton,
          set: {
            topN: input.topN,
            halfLifeHours: input.halfLifeHours,
            hnConfig: input.hnConfig,
            redditConfig: input.redditConfig,
            webConfig: input.webConfig,
            scheduleTime: input.scheduleTime,
            scheduleTimezone: input.scheduleTimezone,
            scheduleEnabled: input.scheduleEnabled,
            updatedAt: now,
          },
        })
        .returning();
      return toDomain(row);
    },
  };
}
