#!/usr/bin/env tsx
/**
 * review-archive CLI — drives the production newsletter API for editorial re-review.
 *
 * Auth: logs in with creds from `.env` in this dir, caches the `admin_session`
 * cookie to `.session` (gitignored), reuses it until a 401, then re-logs in.
 *
 * All output is JSON on stdout so the calling skill can parse it. Errors go to
 * stderr and exit non-zero. Nothing here makes an editorial judgement — that is
 * the skill's (Claude's) job; this is the transport + a couple of read shapers.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(HERE, ".env");
const SESSION_PATH = join(HERE, ".session");
const COOKIE_NAME = "admin_session";

type Env = {
  baseUrl: string;
  email: string;
  password: string;
};

function loadEnv(): Env {
  if (!existsSync(ENV_PATH)) {
    fail(
      `Missing ${ENV_PATH}. Create it (gitignored) with:\n` +
        `  REVIEW_API_BASE_URL=https://news.vertexcover.io\n` +
        `  REVIEW_ADMIN_EMAIL=you@example.com\n` +
        `  REVIEW_ADMIN_PASSWORD=...`,
    );
  }
  const raw = readFileSync(ENV_PATH, "utf8");
  const vars: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  const baseUrl = (vars.REVIEW_API_BASE_URL ?? "").replace(/\/$/, "");
  const email = vars.REVIEW_ADMIN_EMAIL ?? "";
  const password = vars.REVIEW_ADMIN_PASSWORD ?? "";
  if (!baseUrl || !email || !password) {
    fail(
      `${ENV_PATH} must set REVIEW_API_BASE_URL, REVIEW_ADMIN_EMAIL, REVIEW_ADMIN_PASSWORD.`,
    );
  }
  return { baseUrl, email, password };
}

function readCachedCookie(): string | null {
  if (!existsSync(SESSION_PATH)) return null;
  const v = readFileSync(SESSION_PATH, "utf8").trim();
  return v.length > 0 ? v : null;
}

function writeCachedCookie(cookie: string): void {
  writeFileSync(SESSION_PATH, cookie, { mode: 0o600 });
}

function parseSetCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  // Node joins multiple Set-Cookie headers with ", " — find ours by name.
  for (const part of setCookie.split(/,(?=\s*\w+=)/)) {
    const m = part.match(new RegExp(`(?:^|\\s)${COOKIE_NAME}=([^;]+)`));
    if (m) return `${COOKIE_NAME}=${m[1]}`;
  }
  return null;
}

async function login(env: Env): Promise<string> {
  const res = await fetch(`${env.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: env.email, password: env.password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(`Login failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const cookie = parseSetCookie(res.headers.get("set-cookie"));
  if (!cookie) fail("Login succeeded but no admin_session cookie was returned.");
  writeCachedCookie(cookie);
  return cookie;
}

/**
 * Authenticated request with one transparent re-login on 401. The cookie is
 * HttpOnly so we can only ever hold the value we were handed at login; on
 * expiry the server hands us a fresh one.
 */
async function api(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  let cookie = readCachedCookie() ?? (await login(env));
  const doFetch = (c: string) =>
    fetch(`${env.baseUrl}${path}`, {
      method,
      headers: {
        cookie: c,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  let res = await doFetch(cookie);
  if (res.status === 401) {
    cookie = await login(env);
    res = await doFetch(cookie);
  }
  const text = await res.text();
  if (!res.ok) {
    fail(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204 || text.length === 0) return { ok: true };
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function fail(msg: string): never {
  process.stderr.write(msg.endsWith("\n") ? msg : `${msg}\n`);
  process.exit(1);
}

function out(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => resolve(buf));
    if (process.stdin.isTTY) resolve("");
  });
}

// ── command handlers ───────────────────────────────────────────────────────

type ArchiveDetail = {
  id: string;
  status: string;
  reviewed: boolean;
  issueDate: string;
  rankedItems: Array<Record<string, unknown>>;
  shortlistedItemIds: number[] | null;
  digestHeadline: string | null;
  digestSummary: string | null;
  hook: string | null;
};

async function cmdRuns(env: Env, limit: number): Promise<void> {
  const data = (await api(env, "GET", `/api/runs?limit=${limit}`)) as {
    runs: Array<Record<string, unknown>>;
  };
  out(data);
}

/** Resolve "today's run": newest completed run, or match an explicit issueDate. */
async function cmdTodaysRun(env: Env, issueDate?: string): Promise<void> {
  const data = (await api(env, "GET", `/api/runs?limit=30`)) as {
    runs: Array<{ id: string; status: string; reviewed: boolean; issueDate: string }>;
  };
  const runs = data.runs ?? [];
  const completed = runs.filter((r) => r.status === "completed");
  const picked = issueDate
    ? completed.find((r) => r.issueDate === issueDate)
    : completed[0];
  if (!picked) {
    fail(
      issueDate
        ? `No completed run found for issueDate ${issueDate}.`
        : `No completed run found in the latest 30 runs.`,
    );
  }
  out(picked);
}

async function cmdArchive(env: Env, runId: string): Promise<void> {
  const data = await api(env, "GET", `/api/admin/archives/${runId}`);
  out(data);
}

/**
 * Combined snapshot the skill needs to start a review: the selected list
 * (rankedItems, in rank order) plus the shortlisted-but-not-selected pool.
 * One call so the skill doesn't have to stitch two reads.
 */
async function cmdReviewSnapshot(env: Env, runId: string): Promise<void> {
  const archive = (await api(
    env,
    "GET",
    `/api/admin/archives/${runId}`,
  )) as ArchiveDetail;
  const pool = (await api(
    env,
    "GET",
    `/api/admin/archives/${runId}/pool?shortlisted=true&limit=100`,
  )) as { items: Array<Record<string, unknown>>; total: number };

  const selectedIds = new Set(
    archive.rankedItems.map((r) => Number(r.id ?? r.rawItemId)),
  );
  const shortlistedPool = pool.items.filter((i) => !selectedIds.has(Number(i.id)));

  out({
    runId: archive.id,
    issueDate: archive.issueDate,
    reviewed: archive.reviewed,
    digestHeadline: archive.digestHeadline,
    digestSummary: archive.digestSummary,
    hook: archive.hook,
    selected: archive.rankedItems,
    selectedCount: archive.rankedItems.length,
    shortlistedPool,
    shortlistedPoolCount: shortlistedPool.length,
    shortlistedTotalInPool: pool.total,
  });
}

async function cmdPool(
  env: Env,
  runId: string,
  shortlistedOnly: boolean,
  limit: number,
): Promise<void> {
  const q = `shortlisted=${shortlistedOnly ? "true" : "false"}&limit=${limit}`;
  const data = await api(env, "GET", `/api/admin/archives/${runId}/pool?${q}`);
  out(data);
}

/** Body comes from stdin: the full PatchArchivePayload the skill assembled. */
async function cmdPatch(env: Env, runId: string): Promise<void> {
  const stdin = await readStdin();
  if (!stdin.trim()) fail("patch expects a JSON PatchArchivePayload on stdin.");
  let payload: unknown;
  try {
    payload = JSON.parse(stdin);
  } catch (e) {
    fail(`Invalid JSON on stdin: ${(e as Error).message}`);
  }
  const data = await api(env, "PATCH", `/api/admin/archives/${runId}`, payload);
  out(data);
}

async function cmdPromote(env: Env, runId: string, rawItemId: number): Promise<void> {
  const data = await api(env, "POST", `/api/admin/archives/${runId}/promote`, {
    rawItemId,
  });
  out(data);
}

async function cmdAddPost(env: Env, runId: string, url: string): Promise<void> {
  const data = await api(env, "POST", `/api/admin/archives/${runId}/add-post`, {
    url,
  });
  out(data);
}

async function cmdRegenDigest(env: Env, runId: string): Promise<void> {
  const stdin = await readStdin();
  if (!stdin.trim())
    fail("regen-digest expects {items:[{id,title,summary,bottomLine}]} on stdin.");
  const payload = JSON.parse(stdin);
  const data = await api(
    env,
    "POST",
    `/api/admin/archives/${runId}/regenerate-digest-meta`,
    payload,
  );
  out(data);
}

function usage(): never {
  process.stderr.write(
    `review-archive CLI — verbs:

  whoami                          check creds + that login works
  runs [--limit N]                list recent runs (default 30)
  todays-run [--date YYYY-MM-DD]  newest completed run, or run for a date
  archive <runId>                 full admin archive detail (raw)
  snapshot <runId>                review snapshot: selected + shortlisted pool
  pool <runId> [--all] [--limit N]  pool items (default shortlisted-only)
  patch <runId>                   PATCH archive; PatchArchivePayload on stdin
  promote <runId> <rawItemId>     promote a pool item into the selected list
  add-post <runId> <url>          add an external URL as a new item
  regen-digest <runId>            regenerate digest meta; {items:[...]} on stdin

Reads creds from .env in the skill dir; caches the session cookie in .session.
`,
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const [verb, ...rest] = process.argv.slice(2);
  if (!verb || verb === "-h" || verb === "--help") usage();
  const env = loadEnv();

  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    return i !== -1 ? rest[i + 1] : undefined;
  };
  const has = (name: string): boolean => rest.includes(name);

  switch (verb) {
    case "whoami": {
      await login(env);
      const me = await api(env, "GET", `/api/auth/me`);
      out({ ok: true, baseUrl: env.baseUrl, me });
      return;
    }
    case "runs":
      return cmdRuns(env, Number(flag("--limit") ?? 30));
    case "todays-run":
      return cmdTodaysRun(env, flag("--date"));
    case "archive":
      if (!rest[0]) fail("archive needs <runId>");
      return cmdArchive(env, rest[0]);
    case "snapshot":
      if (!rest[0]) fail("snapshot needs <runId>");
      return cmdReviewSnapshot(env, rest[0]);
    case "pool":
      if (!rest[0]) fail("pool needs <runId>");
      return cmdPool(env, rest[0], !has("--all"), Number(flag("--limit") ?? 100));
    case "patch":
      if (!rest[0]) fail("patch needs <runId>");
      return cmdPatch(env, rest[0]);
    case "promote":
      if (!rest[0] || !rest[1]) fail("promote needs <runId> <rawItemId>");
      return cmdPromote(env, rest[0], Number(rest[1]));
    case "add-post":
      if (!rest[0] || !rest[1]) fail("add-post needs <runId> <url>");
      return cmdAddPost(env, rest[0], rest[1]);
    case "regen-digest":
      if (!rest[0]) fail("regen-digest needs <runId>");
      return cmdRegenDigest(env, rest[0]);
    default:
      usage();
  }
}

main().catch((e) => fail((e as Error).stack ?? String(e)));
