/**
 * Live SES smoke test — verifies the SesProvider end-to-end against the real
 * AWS SES API in our sandbox account.
 *
 * Gated by RUN_LIVE_SES=1 because:
 *  - It costs a real send (counts against the 200/24h sandbox quota)
 *  - It depends on AWS_* credentials in .env.harness being current
 *  - It requires aman@vertexcover.io to be verified in SES
 *
 * To run:
 *   set -a && source .env.harness && set +a
 *   RUN_LIVE_SES=1 pnpm --filter @newsletter/api exec vitest run \
 *     --project e2e tests/e2e/live-ses.e2e.test.ts
 */
import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { createSesProvider } from "@api/lib/email/ses-provider.js";

function findRepoCommonRoot(): string {
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      encoding: "utf8",
    }).trim();
    return resolve(gitCommonDir, "..");
  } catch {
    return process.cwd();
  }
}

const REPO_ROOT = findRepoCommonRoot();
config({ path: resolve(REPO_ROOT, ".env.harness"), override: false });

const RUN_LIVE = process.env.RUN_LIVE_SES === "1";
const VERIFIED_ADDRESS = "aman@vertexcover.io";

describe.skipIf(!RUN_LIVE)("SES live send (sandbox)", () => {
  it("sends a real email to the verified address and returns a MessageId", async () => {
    const provider = createSesProvider();
    const result = await provider.send({
      from: VERIFIED_ADDRESS,
      to: [VERIFIED_ADDRESS],
      subject: `VER-85 SES smoke test — ${new Date().toISOString()}`,
      html: "<h1>VER-85 SES live smoke</h1><p>If you received this, the SesProvider is wired correctly.</p>",
      text: "VER-85 SES live smoke. If you received this, the SesProvider is wired correctly.",
      headers: {
        "List-Unsubscribe": "<mailto:unsubscribe@news.vertexcover.io>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    expect(result.messageId).toBeTruthy();
    // SES v2 returns IDs like "0100019df8b4526c-59f45b5e-...-000000"
    expect(result.messageId).toMatch(/^[0-9a-f]{16}-[0-9a-f-]+-\d{6}$/);
     
    console.log("SES MessageId:", result.messageId);
  }, 30000);
});
