#!/usr/bin/env tsx
/**
 * Production OAuth helper for X / Twitter (OAuth 2.0 + PKCE).
 *
 * Spins up a localhost callback server, captures the authorization code,
 * exchanges (with PKCE code_verifier + Basic auth) for tokens, then upserts
 * a row into the social_tokens table via SocialTokensRepo.
 *
 * Usage: pnpm tsx scripts/auth-twitter.ts
 *
 * Reads TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET from .env.
 */
import { createServer } from "node:http";
import { resolve } from "node:path";
import { config as dotenv } from "dotenv";

import { getDb } from "@newsletter/shared";
import { createSocialTokensRepo } from "../packages/pipeline/src/repositories/social-tokens.js";
import {
  buildTwitterAuthorizeUrl,
  generatePkcePair,
  parseTokenResponse,
} from "../packages/pipeline/src/social/cli-helpers.js";

dotenv({ path: resolve(process.cwd(), ".env") });

const PORT = 8765;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://127.0.0.1:${PORT}${CALLBACK_PATH}`;
const SCOPE = "tweet.read tweet.write users.read offline.access";
const TOKEN_ENDPOINT = "https://api.twitter.com/2/oauth2/token";

const clientId = process.env.TWITTER_CLIENT_ID;
const clientSecret = process.env.TWITTER_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error(
    "Missing TWITTER_CLIENT_ID or TWITTER_CLIENT_SECRET in .env",
  );
  process.exit(2);
}

const state = Math.random().toString(36).slice(2);
const { codeVerifier, codeChallenge } = generatePkcePair();

const authorizeUrl = buildTwitterAuthorizeUrl({
  clientId,
  redirectUri: REDIRECT_URI,
  state,
  scope: SCOPE,
  codeChallenge,
});

console.log("\n" + "=".repeat(72));
console.log("X / Twitter OAuth — production token seed");
console.log("=".repeat(72));
console.log("\n→ Open this URL in your browser and click 'Authorize app':\n");
console.log("  " + authorizeUrl);
console.log(
  "\n(waiting on http://127.0.0.1:" + PORT + " for the callback...)\n",
);

function basicAuth(id: string, secret: string): string {
  return Buffer.from(`${id}:${secret}`).toString("base64");
}

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
      `X returned error: ${error} - ${url.searchParams.get("error_description") ?? ""}`,
    );
    console.error(
      "\n✗ X returned error:",
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
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: codeVerifier,
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

    if (parsed.refreshToken === null) {
      console.error(
        "\n✗ No refresh_token returned by X. Verify your app is configured as a" +
          "\n  Confidential client and that the 'offline.access' scope is granted." +
          "\n  Without a refresh token, the access token expires in 2h, which is" +
          "\n  unusable for daily posting. Aborting without writing a row.",
      );
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("missing refresh_token — see terminal");
      server.close();
      process.exit(1);
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<h1>✓ Done</h1><p>You can close this tab. Check your terminal.</p>",
    );

    const repo = createSocialTokensRepo(getDb());
    await repo.saveToken("twitter", {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      metadata: null,
    });

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
