import { createLogger } from "@newsletter/shared/logger";

const WEB_PROXY_ENV = "WEB_HTTP_PROXY";
const logger = createLogger("web-fetch:proxy");

export function resolveWebProxyUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env[WEB_PROXY_ENV]?.trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    logger.warn(
      { event: "web_proxy.malformed", reason: "unparseable" },
      "WEB_HTTP_PROXY ignored — not a valid URL",
    );
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    logger.warn(
      { event: "web_proxy.malformed", reason: "non-http-protocol" },
      "WEB_HTTP_PROXY ignored — non-http(s) protocol",
    );
    return null;
  }

  return raw;
}
