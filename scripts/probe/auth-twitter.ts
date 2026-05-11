// Probe-only OAuth helper for X (Twitter).
// Runs a one-shot localhost callback to capture an authorization code,
// exchanges it for tokens via OAuth 2.0 PKCE + Confidential client.
//
// Usage: pnpm tsx scripts/probe/auth-twitter.ts
//
// Reads TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET from .env.harness.
// Prints the values you need to paste back into .env.harness:
//   TWITTER_TEST_ACCESS_TOKEN=...
//   TWITTER_TEST_REFRESH_TOKEN=...

import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

const PORT = 8765;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://127.0.0.1:${PORT}${CALLBACK_PATH}`;

dotenv({ path: resolve(process.cwd(), ".env.harness") });

const clientId = process.env.TWITTER_CLIENT_ID;
const clientSecret = process.env.TWITTER_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Missing TWITTER_CLIENT_ID or TWITTER_CLIENT_SECRET in .env.harness");
  process.exit(2);
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

const codeVerifier = base64url(randomBytes(32));
const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
const state = base64url(randomBytes(16));

const scope = "tweet.read tweet.write users.read offline.access";

const authorizeUrl =
  `https://twitter.com/i/oauth2/authorize` +
  `?response_type=code` +
  `&client_id=${encodeURIComponent(clientId)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&scope=${encodeURIComponent(scope)}` +
  `&state=${state}` +
  `&code_challenge=${codeChallenge}` +
  `&code_challenge_method=S256`;

console.log("\n" + "=".repeat(72));
console.log("X / Twitter OAuth probe-auth");
console.log("=".repeat(72));
console.log("\n→ Open this URL in your browser and click 'Authorize app':\n");
console.log("  " + authorizeUrl);
console.log("\n(waiting on http://127.0.0.1:" + PORT + " for the callback...)\n");

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
    res.end(`X returned error: ${error} - ${url.searchParams.get("error_description") ?? ""}`);
    console.error("\n✗ X returned error:", error, url.searchParams.get("error_description"));
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
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const tokenResp = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
        client_id: clientId,
      }),
    });
    const tokenJson = (await tokenResp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenResp.ok || !tokenJson.access_token) {
      throw new Error(`token exchange failed: ${tokenResp.status} ${JSON.stringify(tokenJson)}`);
    }

    console.log("✓ Got access token (expires in " + tokenJson.expires_in + "s)");
    if (tokenJson.refresh_token) {
      console.log("✓ Got refresh token (X rotates this on every refresh — keep it safe)");
    } else {
      console.warn("⚠ No refresh token returned. Did you include 'offline.access' in scopes?");
    }
    console.log("✓ Granted scopes:", tokenJson.scope);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<h1>✓ Done</h1><p>You can close this tab. Check your terminal for the values to paste into .env.harness.</p>",
    );

    console.log("\n" + "=".repeat(72));
    console.log("Add these lines to /Users/amankumar/Documents/newsletter/.env.harness:");
    console.log("=".repeat(72));
    console.log(`TWITTER_TEST_ACCESS_TOKEN=${tokenJson.access_token}`);
    console.log(`TWITTER_TEST_REFRESH_TOKEN=${tokenJson.refresh_token ?? "<NOT_RETURNED — see warning above>"}`);
    console.log("=".repeat(72) + "\n");

    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 500);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(String(err));
    console.error("\n✗ Failed:", err);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, "127.0.0.1");
