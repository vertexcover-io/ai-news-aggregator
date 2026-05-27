#!/usr/bin/env tsx
/**
 * Production OAuth helper for LinkedIn.
 *
 * Spins up a localhost callback server, captures the authorization code,
 * exchanges for tokens, fetches /v2/userinfo to derive the person URN,
 * then upserts a row into the social_tokens table via SocialTokensRepo.
 *
 * Usage: pnpm tsx scripts/auth-linkedin.ts
 *
 * Reads LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET from .env.
 */
import { createServer } from "node:http";
import { resolve } from "node:path";
import { config as dotenv } from "dotenv";

import { getDb } from "@newsletter/shared";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { createSocialTokensRepo } from "../packages/pipeline/src/repositories/social-tokens.js";
import {
  buildLinkedInAuthorizeUrl,
  parseTokenResponse,
} from "../packages/pipeline/src/social/cli-helpers.js";

dotenv({ path: resolve(process.cwd(), ".env") });

const PORT = 8765;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://127.0.0.1:${PORT}${CALLBACK_PATH}`;
const SCOPE = "openid profile email w_member_social";
const TOKEN_ENDPOINT = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_ENDPOINT = "https://api.linkedin.com/v2/userinfo";

const SETUP_HELP = `
=============================================================================
⚠ LinkedIn did not return a refresh_token.

Programmatic refresh tokens are off by default for the "Share on LinkedIn"
product. To enable them:

  1. Go to https://www.linkedin.com/developers/apps and open your app.
  2. Open the "Auth" tab.
  3. Under "OAuth 2.0 settings", enable "Programmatic refresh tokens".
  4. Save, then re-run this script.

The access token has been written to social_tokens with refresh_token = ''
so the row exists, but the refresher will fail until you re-run this script
after enabling programmatic refresh.
=============================================================================
`.trim();

const clientId = process.env.LINKEDIN_CLIENT_ID;
const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error(
    "Missing LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET in .env",
  );
  process.exit(2);
}

const state = Math.random().toString(36).slice(2);
const authorizeUrl = buildLinkedInAuthorizeUrl({
  clientId,
  redirectUri: REDIRECT_URI,
  state,
  scope: SCOPE,
});

console.log("\n" + "=".repeat(72));
console.log("LinkedIn OAuth — production token seed");
console.log("=".repeat(72));
console.log("\n→ Open this URL in your browser and click 'Allow':\n");
console.log("  " + authorizeUrl);
console.log(
  "\n(waiting on http://127.0.0.1:" + PORT + " for the callback...)\n",
);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "", `http://127.0.0.1:${PORT}`);
  if (url.pathname !== CALLBACK_PATH) {
    res.writeHead(404);
    res.end("not the right path");
    return;
  }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(
      `LinkedIn returned error: ${error} - ${url.searchParams.get("error_description") ?? ""}`,
    );
    console.error(
      "\n✗ LinkedIn returned error:",
      error,
      url.searchParams.get("error_description"),
    );
    server.close();
    process.exit(1);
  }
  if (!code || returnedState !== state) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing code or state mismatch");
    console.error("\n✗ Missing code or state mismatch");
    server.close();
    process.exit(1);
  }

  try {
    console.log("✓ Received auth code; exchanging for tokens...");
    const tokenResp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const tokenJson = (await tokenResp.json()) as unknown;
    if (!tokenResp.ok) {
      throw new Error(
        `token exchange failed: ${tokenResp.status} ${JSON.stringify(tokenJson)}`,
      );
    }

    const parsed = parseTokenResponse(tokenJson);
    if ("error" in parsed) {
      throw new Error(`bad token response: ${parsed.error}`);
    }

    console.log("✓ Fetching /v2/userinfo to derive person URN...");
    const uinfoResp = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${parsed.accessToken}` },
    });
    const uinfo = (await uinfoResp.json()) as {
      sub?: string;
      name?: string;
      email?: string;
    };
    if (!uinfoResp.ok || !uinfo.sub) {
      throw new Error(
        `userinfo failed: ${uinfoResp.status} ${JSON.stringify(uinfo)}`,
      );
    }
    const personUrn = `urn:li:person:${uinfo.sub}`;
    console.log("✓ User:", uinfo.name, "(" + uinfo.email + ")");
    console.log("✓ Person URN:", personUrn);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<h1>✓ Done</h1><p>You can close this tab. Check your terminal.</p>",
    );

    const repo = createSocialTokensRepo(getDb(), getCredentialCipher());
    const missingRefresh = parsed.refreshToken === null;

    await repo.saveToken("linkedin", {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? "",
      expiresAt: parsed.expiresAt,
      metadata: { personUrn },
    });

    if (missingRefresh) {
      console.log("\n" + SETUP_HELP);
      setTimeout(() => {
        server.close();
        process.exit(1);
      }, 250);
      return;
    }

    console.log(
      `\n✅ Done — access_token expires ${parsed.expiresAt.toISOString()}. Re-run before then to renew.`,
    );
    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 250);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(String(err));
    console.error("\n✗ Failed:", err);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, "127.0.0.1");
