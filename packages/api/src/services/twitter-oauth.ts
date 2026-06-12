/**
 * Twitter OAuth2 PKCE helpers for the API layer (REQ-081).
 *
 * Implemented behind injectable client interfaces around twitter-api-v2's
 * generateOAuth2AuthLink / loginWithOAuth2 / refreshOAuth2Token. The concrete
 * TwitterApi constructor is injected at composition time (index.ts) so this
 * module — and its tests — never import the SDK directly.
 */

export const TWITTER_OAUTH_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
] as const;

/** Shared Twitter OAuth2 app client (app-level secret, REQ-082). */
export interface TwitterOAuthAppCreds {
  clientId: string;
  clientSecret: string;
}

export function resolveTwitterOAuthAppCreds(
  env: Record<string, string | undefined>,
): TwitterOAuthAppCreds | null {
  const clientId = env.TWITTER_OAUTH_CLIENT_ID;
  const clientSecret = env.TWITTER_OAUTH_CLIENT_SECRET;
  if (clientId === undefined || clientId === "") return null;
  if (clientSecret === undefined || clientSecret === "") return null;
  return { clientId, clientSecret };
}

export interface TwitterAuthLink {
  url: string;
  state: string;
  codeVerifier: string;
}

export interface TwitterTokenSet {
  accessToken: string;
  /** null when Twitter omitted the refresh token. */
  refreshToken: string | null;
  expiresAt: Date;
  /** Connected account handle (e.g. "@agentloop"); null when the lookup failed. */
  connectedAs: string | null;
}

export type TwitterExchangeResult =
  | { ok: true; tokens: TwitterTokenSet }
  | { ok: false; detail: string };

export type TwitterRefreshTokensResult =
  | {
      ok: true;
      tokens: Omit<TwitterTokenSet, "connectedAs">;
    }
  | { ok: false; detail: string };

export interface TwitterOAuthService {
  generateAuthLink(redirectUri: string): TwitterAuthLink;
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<TwitterExchangeResult>;
  refreshToken(refreshToken: string): Promise<TwitterRefreshTokensResult>;
}

// ── structural slice of twitter-api-v2's TwitterApi ──────────────────────────

export interface TwitterOAuth2TokenResultLike {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface TwitterOAuth2LoginResultLike
  extends TwitterOAuth2TokenResultLike {
  client: {
    v2: { me(): Promise<{ data: { username?: string; name?: string } }> };
  };
}

export interface TwitterApiOAuth2Like {
  generateOAuth2AuthLink(
    redirectUri: string,
    options: { scope: string[] },
  ): { url: string; state: string; codeVerifier: string };
  loginWithOAuth2(args: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<TwitterOAuth2LoginResultLike>;
  refreshOAuth2Token(
    refreshToken: string,
  ): Promise<TwitterOAuth2TokenResultLike>;
}

export type TwitterApiCtorLike = new (creds: {
  clientId: string;
  clientSecret: string;
}) => TwitterApiOAuth2Like;

// ── service ───────────────────────────────────────────────────────────────────

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function expiryFrom(expiresIn: number, now: () => Date): Date {
  return new Date(now().getTime() + expiresIn * 1000);
}

export function createTwitterOAuthService(
  creds: TwitterOAuthAppCreds,
  options: { TwitterApiCtor: TwitterApiCtorLike; now?: () => Date },
): TwitterOAuthService {
  const now = options.now ?? ((): Date => new Date());
  const makeClient = (): TwitterApiOAuth2Like =>
    new options.TwitterApiCtor({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });

  return {
    generateAuthLink(redirectUri: string): TwitterAuthLink {
      const link = makeClient().generateOAuth2AuthLink(redirectUri, {
        scope: [...TWITTER_OAUTH_SCOPES],
      });
      return {
        url: link.url,
        state: link.state,
        codeVerifier: link.codeVerifier,
      };
    },

    async exchangeCode(input): Promise<TwitterExchangeResult> {
      let login: TwitterOAuth2LoginResultLike;
      try {
        login = await makeClient().loginWithOAuth2({
          code: input.code,
          codeVerifier: input.codeVerifier,
          redirectUri: input.redirectUri,
        });
      } catch (err) {
        return { ok: false, detail: errorDetail(err) };
      }

      // Best-effort account lookup — connection must not fail when the
      // profile read does (posting only needs the token).
      let connectedAs: string | null;
      try {
        const me = await login.client.v2.me();
        connectedAs =
          typeof me.data.username === "string" && me.data.username !== ""
            ? `@${me.data.username}`
            : (me.data.name ?? null);
      } catch {
        connectedAs = null;
      }

      return {
        ok: true,
        tokens: {
          accessToken: login.accessToken,
          refreshToken: login.refreshToken ?? null,
          expiresAt: expiryFrom(login.expiresIn, now),
          connectedAs,
        },
      };
    },

    async refreshToken(refreshToken): Promise<TwitterRefreshTokensResult> {
      try {
        const refreshed = await makeClient().refreshOAuth2Token(refreshToken);
        return {
          ok: true,
          tokens: {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken ?? null,
            expiresAt: expiryFrom(refreshed.expiresIn, now),
          },
        };
      } catch (err) {
        return { ok: false, detail: errorDetail(err) };
      }
    },
  };
}
