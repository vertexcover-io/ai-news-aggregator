import { eq } from "drizzle-orm";
import { appCredentials } from "@newsletter/shared/db";
import type { AppDb, AppCredentialPlatform } from "@newsletter/shared/db";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";

export interface AppCredentialRecord {
  platform: AppCredentialPlatform;
  encryptedFields: Record<string, string>;
  metadata: Record<string, unknown> | null;
  updatedAt: Date;
}

export interface AppCredentialsRepo {
  get(platform: AppCredentialPlatform): Promise<AppCredentialRecord | null>;
  upsert(
    platform: AppCredentialPlatform,
    encryptedFields: Record<string, string>,
    metadata?: Record<string, unknown> | null,
  ): Promise<AppCredentialRecord>;
}

/** Super-admin-only: manage app-level credentials. Never exposed to tenants. */
export function createAppCredentialsRepo(
  db: Pick<AppDb, "select" | "insert">,
  _cipher: CredentialCipher,
): AppCredentialsRepo {
  return {
    async get(platform: AppCredentialPlatform): Promise<AppCredentialRecord | null> {
      const rows = await db
        .select()
        .from(appCredentials)
        .where(eq(appCredentials.platform, platform))
        .limit(1);
      return rows[0] ?? null;
    },

    async upsert(
      platform: AppCredentialPlatform,
      encryptedFields: Record<string, string>,
      metadata?: Record<string, unknown> | null,
    ): Promise<AppCredentialRecord> {
      const now = new Date();
      const [row] = await db
        .insert(appCredentials)
        .values({
          platform,
          encryptedFields,
          metadata: metadata ?? null,
          updatedAt: now,
          updatedBy: "super_admin",
        })
        .onConflictDoUpdate({
          target: appCredentials.platform,
          set: { encryptedFields, metadata: metadata ?? null, updatedAt: now, updatedBy: "super_admin" },
        })
        .returning();
      return row;
    },
  };
}
