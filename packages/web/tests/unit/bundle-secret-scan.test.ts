/**
 * NF6 / REQ-125 (bundle half): no app-level secret material in the built web
 * bundle. Scans every text asset Vite emitted to dist/ for (a) server-only
 * secret env-var names, (b) secret-shaped values (provider key prefixes,
 * credentialed DSNs), and (c) actual secret values from the repo .env.
 *
 * Skips with a pointer when dist/ is absent — `pnpm --filter @newsletter/web
 * test:bundle` is the build-then-scan entrypoint (also the CI shape).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "../../dist");
const repoEnvFile = resolve(here, "../../../../.env");

// Server-only env names — none of these may be referenced by client code.
const SECRET_ENV_NAMES = [
  "SESSION_SECRET",
  "ADMIN_PASSWORD",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "RESEND_API_KEY",
  "TAVILY_API_KEY",
  "RETTIWT_API_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "LINKEDIN_CLIENT_SECRET",
  "TWITTER_API_SECRET",
  "TWITTER_ACCESS_TOKEN_SECRET",
  "TWITTER_OAUTH_CLIENT_SECRET",
  "AGENTLOOP_ADMIN_PASSWORD",
  "SUPER_ADMIN_PASSWORD",
  "DATABASE_URL",
  "REDIS_URL",
];

// Secret-shaped values, regardless of where they came from.
const SECRET_VALUE_PATTERNS: [label: string, re: RegExp][] = [
  ["Anthropic API key", /sk-ant-[A-Za-z0-9_-]{8,}/],
  ["generic sk- API key", /\bsk-[A-Za-z0-9]{24,}/],
  ["Resend API key", /\bre_[A-Za-z0-9]{16,}/],
  ["Tavily API key", /tvly-[A-Za-z0-9-]{12,}/],
  ["credentialed Postgres DSN", /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`]+@/],
  ["Redis DSN", /redis:\/\/[^\s"'`]+/],
];

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".css",
  ".html",
  ".json",
  ".txt",
  ".svg",
  ".webmanifest",
  ".map",
]);

function listTextFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTextFiles(full));
    else if (TEXT_EXTENSIONS.has(extname(entry.name))) out.push(full);
  }
  return out;
}

/** Secret VALUES from the repo .env (keys that look secret, values long
 * enough to be unambiguous). Vite only inlines VITE_*-prefixed vars, so any
 * hit here means a real leak. */
function envSecretValues(): [label: string, value: string][] {
  if (!existsSync(repoEnvFile)) return [];
  const out: [string, string][] = [];
  for (const line of readFileSync(repoEnvFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    if (!/(SECRET|PASSWORD|TOKEN|API_KEY|_KEY$)/.test(key)) continue;
    if (key.startsWith("VITE_")) continue;
    const value = raw.replace(/^["']|["']$/g, "");
    if (value.length >= 16) out.push([`.env value of ${key}`, value]);
  }
  return out;
}

describe("REQ-125: web bundle secret scan", () => {
  it("test_REQ_125_no_app_secret_in_bundle", (ctx) => {
    if (!existsSync(join(distDir, "index.html"))) {
      ctx.skip(
        "dist/ not built — run `pnpm --filter @newsletter/web test:bundle` to build and scan",
      );
    }

    const findings: string[] = [];
    const valueSecrets = envSecretValues();
    for (const file of listTextFiles(distDir)) {
      const content = readFileSync(file, "utf8");
      const rel = relative(distDir, file);
      for (const name of SECRET_ENV_NAMES) {
        if (content.includes(name)) findings.push(`${rel}: env name ${name}`);
      }
      for (const [label, re] of SECRET_VALUE_PATTERNS) {
        const hit = re.exec(content);
        if (hit) findings.push(`${rel}: ${label} (${hit[0].slice(0, 12)}…)`);
      }
      for (const [label, value] of valueSecrets) {
        if (content.includes(value)) findings.push(`${rel}: ${label}`);
      }
    }

    expect(findings, findings.join("\n")).toEqual([]);
  });
});
