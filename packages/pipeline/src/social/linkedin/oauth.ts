export interface LinkedInRefreshInput {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export type LinkedInRefreshResult =
  | { ok: true; accessToken: string; refreshToken: string; expiresAt: Date }
  | { ok: false; status: number; body: string };

const ENDPOINT = "https://www.linkedin.com/oauth/v2/accessToken";

interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export async function refreshLinkedInToken(
  input: LinkedInRefreshInput,
  fetchFn: typeof fetch = fetch,
): Promise<LinkedInRefreshResult> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  }).toString();

  try {
    const response = await fetchFn(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const rawBody = await response.text();

    if (!response.ok) {
      return { ok: false, status: response.status, body: rawBody };
    }

    let parsed: TokenResponseBody;
    try {
      parsed = JSON.parse(rawBody) as TokenResponseBody;
    } catch {
      return { ok: false, status: response.status, body: rawBody };
    }

    const accessToken = parsed.access_token;
    const expiresIn = parsed.expires_in;
    if (typeof accessToken !== "string" || typeof expiresIn !== "number") {
      return { ok: false, status: response.status, body: rawBody };
    }

    const refreshToken =
      typeof parsed.refresh_token === "string" && parsed.refresh_token !== ""
        ? parsed.refresh_token
        : input.refreshToken;

    return {
      ok: true,
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, body: message };
  }
}
