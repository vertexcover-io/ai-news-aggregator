import { eq } from "drizzle-orm";
import { socialTokens } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";

export type SocialPlatform = "linkedin" | "twitter";

export interface SocialTokensRepo {
  hasToken(platform: SocialPlatform): Promise<boolean>;
}

export function createSocialTokensRepo(
  db: Pick<AppDb, "select">,
): SocialTokensRepo {
  return {
    async hasToken(platform: SocialPlatform): Promise<boolean> {
      const rows = await db
        .select({ platform: socialTokens.platform })
        .from(socialTokens)
        .where(eq(socialTokens.platform, platform))
        .limit(1);
      return rows.length > 0;
    },
  };
}
