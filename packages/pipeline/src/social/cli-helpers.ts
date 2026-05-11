import { createHash, randomBytes } from "node:crypto";

export interface BuildLinkedInAuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
}

export interface BuildTwitterAuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge: string;
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export interface ParsedTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

export type ParseTokenResponseResult = ParsedTokenResponse | { error: string };

const LINKEDIN_AUTHORIZE_ENDPOINT =
  "https://www.linkedin.com/oauth/v2/authorization";
const TWITTER_AUTHORIZE_ENDPOINT = "https://twitter.com/i/oauth2/authorize";

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildLinkedInAuthorizeUrl(
  args: BuildLinkedInAuthorizeUrlInput,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    scope: args.scope,
  });
  return `${LINKEDIN_AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export function buildTwitterAuthorizeUrl(
  args: BuildTwitterAuthorizeUrlInput,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    scope: args.scope,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${TWITTER_AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export function generatePkcePair(): PkcePair {
  // 32 random bytes → 43-char base64url string (within RFC 7636 43-128 range,
  // and base64url alphabet is a subset of the unreserved set).
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(
    createHash("sha256").update(codeVerifier).digest(),
  );
  return { codeVerifier, codeChallenge };
}

interface RawTokenBody {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
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
