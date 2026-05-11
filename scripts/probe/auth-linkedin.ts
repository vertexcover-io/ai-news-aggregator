// Probe-only OAuth helper for LinkedIn.
// Runs a one-shot localhost callback to capture an authorization code,
// exchanges it for tokens, then calls /v2/userinfo to derive the person URN.
//
// Usage: pnpm tsx scripts/probe/auth-linkedin.ts
//
// Reads LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET from .env.harness.
// Prints the values you need to paste back into .env.harness:
//   LINKEDIN_TEST_REFRESH_TOKEN=...
//   LINKEDIN_TEST_PERSON_URN=urn:li:person:...

import { createServer } from "node:http";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

const PORT = 8765;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://127.0.0.1:${PORT}${CALLBACK_PATH}`;

dotenv({ path: resolve(process.cwd(), ".env.harness") });

const clientId = process.env.LINKEDIN_CLIENT_ID;
const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Missing LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET in .env.harness");
  process.exit(2);
}

const state = Math.random().toString(36).slice(2);
const scope = "openid profile email w_member_social";
const authorizeUrl =
  `https://www.linkedin.com/oauth/v2/authorization` +
  `?response_type=code` +
  `&client_id=${encodeURIComponent(clientId)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&state=${state}` +
  `&scope=${encodeURIComponent(scope)}`;

console.log("\n" + "=".repeat(72));
console.log("LinkedIn OAuth probe-auth");
console.log("=".repeat(72));
console.log("\n→ Open this URL in your browser and click 'Allow':\n");
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
    res.end(`LinkedIn returned error: ${error} - ${url.searchParams.get("error_description") ?? ""}`);
    console.error("\n✗ LinkedIn returned error:", error, url.searchParams.get("error_description"));
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
    const tokenResp = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
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
    const tokenJson = (await tokenResp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_token_expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenResp.ok || !tokenJson.access_token) {
      throw new Error(`token exchange failed: ${tokenResp.status} ${JSON.stringify(tokenJson)}`);
    }

    console.log("✓ Got access token (expires in " + tokenJson.expires_in + "s)");
    if (tokenJson.refresh_token) {
      console.log("✓ Got refresh token (expires in " + tokenJson.refresh_token_expires_in + "s = ~" +
        Math.round((tokenJson.refresh_token_expires_in ?? 0) / 86400) + " days)");
    } else {
      console.warn("⚠ No refresh token returned. Your LinkedIn app may not have programmatic refresh enabled.");
    }
    console.log("✓ Granted scopes:", tokenJson.scope);

    console.log("✓ Fetching /v2/userinfo to derive person URN...");
    const uinfoResp = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const uinfo = (await uinfoResp.json()) as { sub?: string; name?: string; email?: string };
    if (!uinfoResp.ok || !uinfo.sub) {
      throw new Error(`userinfo failed: ${uinfoResp.status} ${JSON.stringify(uinfo)}`);
    }
    const personUrn = `urn:li:person:${uinfo.sub}`;
    console.log("✓ User:", uinfo.name, "(" + uinfo.email + ")");
    console.log("✓ Person URN:", personUrn);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<h1>✓ Done</h1><p>You can close this tab. Check your terminal for the values to paste into .env.harness.</p>",
    );

    console.log("\n" + "=".repeat(72));
    console.log("Add these lines to /Users/amankumar/Documents/newsletter/.env.harness:");
    console.log("=".repeat(72));
    console.log(`LINKEDIN_TEST_ACCESS_TOKEN=${tokenJson.access_token}`);
    if (tokenJson.refresh_token) {
      console.log(`LINKEDIN_TEST_REFRESH_TOKEN=${tokenJson.refresh_token}`);
    } else {
      console.log(`# LINKEDIN_TEST_REFRESH_TOKEN — not returned (programmatic refresh tokens not enabled on app)`);
    }
    console.log(`LINKEDIN_TEST_PERSON_URN=${personUrn}`);
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
