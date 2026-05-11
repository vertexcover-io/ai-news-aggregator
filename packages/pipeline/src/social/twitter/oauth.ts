export interface TwitterRefreshInput {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export type TwitterRefreshResult =
  | { ok: true; accessToken: string; refreshToken: string; expiresAt: Date }
  | { ok: false; status: number; body: string };

const ENDPOINT = "https://api.twitter.com/2/oauth2/token";

interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

function basicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

export async function refreshTwitterToken(
  input: TwitterRefreshInput,
  fetchFn: typeof fetch = fetch,
): Promise<TwitterRefreshResult> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  }).toString();

  try {
    const response = await fetchFn(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth(input.clientId, input.clientSecret)}`,
      },
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

    const refreshToken = parsed.refresh_token;
    if (typeof refreshToken !== "string" || refreshToken === "") {
      return {
        ok: false,
        status: 0,
        body: "missing refresh_token in response",
      };
    }

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
