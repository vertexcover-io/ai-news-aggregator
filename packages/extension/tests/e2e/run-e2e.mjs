// Hermetic e2e entrypoint for @newsletter/extension.
// Provisions ephemeral Postgres + Redis, migrates, builds the extension with
// VITE_API_BASE pointing at the hermetic API, boots the API via Playwright
// webServer, then runs the Playwright suite. Tears down on exit.
import { execFileSync, execSync, spawn } from "node:child_process";
import { createServer, connect } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../../");
const EXT_DIR = path.resolve(__dirname, "../../");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function podman(args) {
  return execFileSync("podman", args, { encoding: "utf8" }).trim();
}

function tcpOpen(port) {
  return new Promise((resolve) => {
    const sock = connect(port, "127.0.0.1");
    sock.setTimeout(1000);
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("error", () => resolve(false));
    sock.once("timeout", () => (sock.destroy(), resolve(false)));
  });
}

async function waitUntil(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(500);
  }
  throw new Error(`e2e infra: ${label} not ready within ${timeoutMs}ms`);
}

function pgReady(port) {
  try {
    execFileSync("pg_isready", ["-h", "127.0.0.1", "-p", String(port), "-U", "newsletter"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const [pgPort, redisPort, apiPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);

  const env = {
    ...process.env,
    E2E_PG_PORT: String(pgPort),
    E2E_REDIS_PORT: String(redisPort),
    API_PORT: String(apiPort),
    DATABASE_URL: `postgresql://newsletter:newsletter@127.0.0.1:${pgPort}/newsletter`,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    E2E_API_BASE: `http://127.0.0.1:${apiPort}`,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "vertexcover@123",
    SESSION_SECRET:
      process.env.SESSION_SECRET ??
      "test-session-secret-32-bytes-minimum-abcdef1234567890",
    SLACK_WEBHOOK_URL: "",
    // The API constructs an email provider at boot; a dummy key satisfies the
    // Resend constructor (no mail is sent in this suite).
    RESEND_API_KEY: process.env.RESEND_API_KEY ?? "re_e2e_dummy_key",
  };
  env.E2E_ADMIN_PASSWORD = env.ADMIN_PASSWORD;

  let pgCid = "";
  let redisCid = "";
  const stop = (cid) => {
    if (!cid) return;
    try {
      execFileSync("podman", ["stop", cid], { stdio: "ignore" });
    } catch {
      // already gone (--rm)
    }
  };

  try {
    pgCid = podman([
      "run", "--rm", "-d", "-p", `127.0.0.1:${pgPort}:5432`,
      "-e", "POSTGRES_USER=newsletter",
      "-e", "POSTGRES_PASSWORD=newsletter",
      "-e", "POSTGRES_DB=newsletter",
      "postgres:16",
    ]);
    redisCid = podman(["run", "--rm", "-d", "-p", `127.0.0.1:${redisPort}:6379`, "redis:7"]);
    console.log(`[e2e] infra up — pg:${pgPort} redis:${redisPort} api:${apiPort}`);

    await waitUntil(() => pgReady(pgPort), 20_000, "postgres");
    await waitUntil(() => tcpOpen(redisPort), 15_000, "redis");

    execFileSync("pnpm", ["--filter", "@newsletter/shared", "db:migrate"], {
      stdio: "inherit",
      env,
      cwd: ROOT,
    });
    console.log("[e2e] migrations applied");

    // Build the extension pointed at the hermetic API so the popup fetches land there.
    const buildEnv = {
      ...env,
      VITE_API_BASE: `http://127.0.0.1:${apiPort}`,
    };
    console.log(`[e2e] building extension with VITE_API_BASE=http://127.0.0.1:${apiPort}`);
    execFileSync("pnpm", ["--filter", "@newsletter/extension", "build"], {
      stdio: "inherit",
      env: buildEnv,
      cwd: ROOT,
    });
    console.log("[e2e] extension built");

    const code = await new Promise((resolve) => {
      const child = spawn(
        "pnpm",
        ["--filter", "@newsletter/extension", "exec", "playwright", "test", ...process.argv.slice(2)],
        { stdio: "inherit", env },
      );
      child.on("exit", (c) => resolve(c ?? 1));
    });
    process.exitCode = code;
  } finally {
    stop(pgCid);
    stop(redisCid);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
