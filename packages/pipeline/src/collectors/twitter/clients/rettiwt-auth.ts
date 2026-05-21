import { createLogger } from "@newsletter/shared/logger";
import type { SocialCredentialsRepo } from "@pipeline/repositories/social-credentials.js";
import { AuthService } from "rettiwt-api/dist/services/internal/AuthService.js";
import { RettiwtConfig } from "rettiwt-api/dist/models/RettiwtConfig.js";

export interface RettiwtApiKeyHolder {
  apiKey: string | undefined;
}

export interface RettiwtCsrfRefreshDeps {
  rettiwt: RettiwtApiKeyHolder;
  repo: Pick<SocialCredentialsRepo, "upsertTwitterCollector">;
  credentialSource: "db" | "env";
}

const logger = createLogger("collector:twitter-auth");

export async function refreshRettiwtCsrfToken(
  deps: RettiwtCsrfRefreshDeps,
): Promise<boolean> {
  const currentApiKey = deps.rettiwt.apiKey;
  if (!currentApiKey) return false;

  const config = new RettiwtConfig({ apiKey: currentApiKey });
  await AuthService.refreshCsrfToken(config);
  const refreshedApiKey = config.apiKey;
  if (!refreshedApiKey || refreshedApiKey === currentApiKey) {
    logger.warn(
      { event: "collector.twitter.csrf_refresh.no_rotation" },
      "twitter csrf refresh did not rotate api key",
    );
    return false;
  }

  deps.rettiwt.apiKey = refreshedApiKey;
  if (deps.credentialSource === "db") {
    await deps.repo.upsertTwitterCollector({ apiKey: refreshedApiKey });
  }
  logger.info(
    {
      event: "collector.twitter.csrf_refresh.completed",
      persisted: deps.credentialSource === "db",
    },
    "twitter csrf token refreshed",
  );
  return true;
}
