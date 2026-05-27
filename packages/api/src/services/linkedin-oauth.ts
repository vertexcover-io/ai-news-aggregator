/**
 * Pure LinkedIn OAuth helpers for the API layer.
 *
 * These are intentional API-local copies — the API must NOT import from
 * @newsletter/pipeline (enforced by eslint no-restricted-imports). Reference
 * the pipeline's cli-helpers.ts and linkedin/oauth.ts for the original
 * implementations, but do not import from them.
 */

const LINKEDIN_AUTHORIZE_ENDPOINT =
  "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_ENDPOINT =
  "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_USERINFO_ENDPOINT = "https://api.linkedin.com/v2/userinfo";
const LINKEDIN_SCOPE = "openid profile email w_member_social";

export interface BuildAuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
}

export interface ParsedTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

export type ParseTokenResponseResult =
  | ParsedTokenResponse
  | { error: string };

interface RawTokenBody {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

export interface LinkedInUserInfo {
  sub: string;
  name?: string;
  email?: string;
}

export type ExchangeCodeResult =
  | { ok: true; parsed: ParsedTokenResponse }
  | { ok: false; reason: "exchange"; detail: string };

export type FetchUserInfoResult =
  | { ok: true; userInfo: LinkedInUserInfo }
  | { ok: false; reason: "userinfo"; detail: string };

export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    scope: LINKEDIN_SCOPE,
    // Request that LinkedIn re-prompt for login rather than silently reusing the
    // browser's existing LinkedIn SSO session. Intent: a "Reconnect" click should
    // give the admin a chance to authenticate (or switch accounts) instead of an
    // invisible bounce back to settings.
    //
    // CAVEAT: LinkedIn's honoring of `prompt` is inconsistent — when the browser
    // already has an active LinkedIn session it often still auto-completes the
    // flow. Reliable account switching requires logging out of LinkedIn itself,
    // which this app cannot force. We send `prompt=login` as a best-effort hint;
    // it is harmless when ignored.
    prompt: "login",
  });
  return `${LINKEDIN_AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export function parseTokenResponse(json: unknown): ParseTokenResponseResult {
  if (typeof json !== "object" || json === null) {
    return { error: "token response is not an object" };
  }
  const body = json as RawTokenBody;

  const accessToken = body.access_token;
  if (typeof accessToken !== "string" || accessToken === "") {
    return { error: "missing access_token in response" };
  }

  const expiresIn = body.expires_in;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) {
    return { error: "missing or invalid expires_in in response" };
  }

  const refreshTokenRaw = body.refresh_token;
  const refreshToken =
    typeof refreshTokenRaw === "string" && refreshTokenRaw !== ""
      ? refreshTokenRaw
      : null;

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

export async function exchangeCode(
  {
    code,
    clientId,
    clientSecret,
    redirectUri,
  }: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  },
  fetchFn: typeof fetch = fetch,
): Promise<ExchangeCodeResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  }).toString();

  let response: Response;
  try {
    response = await fetchFn(LINKEDIN_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "exchange", detail };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "exchange",
      detail: `HTTP ${response.status}`,
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, reason: "exchange", detail: "non-JSON response body" };
  }

  const parsed = parseTokenResponse(json);
  if ("error" in parsed) {
    return { ok: false, reason: "exchange", detail: parsed.error };
  }
  return { ok: true, parsed };
}

export async function fetchUserInfo(
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<FetchUserInfoResult> {
  let response: Response;
  try {
    response = await fetchFn(LINKEDIN_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "userinfo", detail };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "userinfo",
      detail: `HTTP ${response.status}`,
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, reason: "userinfo", detail: "non-JSON response body" };
  }

  if (
    typeof json !== "object" ||
    json === null ||
    typeof (json as Record<string, unknown>).sub !== "string"
  ) {
    return { ok: false, reason: "userinfo", detail: "missing sub in userinfo" };
  }

  const info = json as Record<string, unknown>;
  return {
    ok: true,
    userInfo: {
      sub: info.sub as string,
      name: typeof info.name === "string" ? info.name : undefined,
      email: typeof info.email === "string" ? info.email : undefined,
    },
  };
}
