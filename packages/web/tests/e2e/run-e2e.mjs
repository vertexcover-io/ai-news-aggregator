// Hermetic e2e entrypoint. Allocates free ephemeral ports, brings up a private
// Postgres + Redis on them, migrates, then runs Playwright (which starts the
// API + web dev servers on the same ports). Infra is torn down on exit. This
// runs BEFORE Playwright's webServer, which globalSetup cannot guarantee.
import { execFileSync, spawn } from "node:child_process";
import { createServer, connect } from "node:net";

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
  const [pgPort, redisPort, apiPort, webPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
    freePort(),
  ]);

  const env = {
    ...process.env,
    E2E_PG_PORT: String(pgPort),
    E2E_REDIS_PORT: String(redisPort),
    WEB_PORT: String(webPort),
    API_PORT: String(apiPort),
    DATABASE_URL: `postgresql://newsletter:newsletter@127.0.0.1:${pgPort}/newsletter`,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    E2E_API_BASE: `http://127.0.0.1:${apiPort}`,
    PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${webPort}`,
    // Shared HMAC secret for subscriber tokens — the API server (token issue +
    // verify) and the specs (which forge expired/edge-case tokens) must agree.
    SESSION_SECRET:
      process.env.SESSION_SECRET ??
      "test-session-secret-32-bytes-minimum-abcdef1234567890",
    // Point confirm/unsubscribe/feedback redirects at the hermetic web server
    // instead of whatever the API's .env declares (e.g. localhost:5173).
    NEWSLETTER_BASE_URL: `http://127.0.0.1:${webPort}`,
  };

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
    console.log(`[e2e] infra up — pg:${pgPort} redis:${redisPort} api:${apiPort} web:${webPort}`);

    await waitUntil(() => pgReady(pgPort), 20_000, "postgres");
    await waitUntil(() => tcpOpen(redisPort), 15_000, "redis");

    execFileSync("pnpm", ["--filter", "@newsletter/shared", "db:migrate"], {
      stdio: "inherit",
      env,
    });

    const code = await new Promise((resolve) => {
      const child = spawn(
        "pnpm",
        ["--filter", "@newsletter/web", "exec", "playwright", "test", ...process.argv.slice(2)],
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
