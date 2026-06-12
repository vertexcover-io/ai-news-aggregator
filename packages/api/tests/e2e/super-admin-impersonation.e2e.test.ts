/**
 * Small e2e for super-admin impersonation against the real DB
 * (REQ-100..103, EDGE-008): the reissued cookie scopes normal tenant routes
 * to the impersonated tenant, and start/stop audit rows land in
 * impersonation_events.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createSuperAdminRouter } from "@api/routes/super-admin.js";
import { requireUser, type AuthEnv } from "@api/auth/middleware.js";
import { issueSession, verifySession, COOKIE_NAME } from "@api/auth/session.js";
import { getTenantId } from "@api/middleware/tenant-host.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const { getDb } = await import("@newsletter/shared/db");
const { createTenantsRepo } = await import("@api/repositories/tenants.js");
const { createImpersonationEventsRepo } = await import(
  "@api/repositories/impersonation-events.js"
);
const { createUserSettingsRepo } = await import(
  "@api/repositories/user-settings.js"
);

const db = getDb();

const SESSION_SECRET = "super-admin-e2e-secret-at-least-32-bytes!";
const SLUGS = { a: "imp-e2e-tenant-a", b: "imp-e2e-tenant-b" } as const;
const SUPER_EMAIL = "root@impersonation-e2e.example.com";

const tenantIds = { a: "", b: "" };
let superAdminId = "";

async function cleanup(): Promise<void> {
  await db.execute(sql`
    DELETE FROM impersonation_events
    WHERE super_admin_user_id IN (SELECT id FROM users WHERE email = ${SUPER_EMAIL})
  `);
  await db.execute(sql`DELETE FROM users WHERE email = ${SUPER_EMAIL}`);
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM tenants WHERE slug IN (${SLUGS.a}, ${SLUGS.b})`,
  );
  for (const row of rows) {
    await db.execute(
      sql`DELETE FROM user_settings WHERE tenant_id = ${row.id}::uuid`,
    );
    await db.execute(sql`DELETE FROM tenants WHERE id = ${row.id}::uuid`);
  }
}

beforeAll(async () => {
  await cleanup();

  for (const key of ["a", "b"] as const) {
    const inserted = await db.execute<{ id: string }>(
      sql`INSERT INTO tenants (slug, name, status)
          VALUES (${SLUGS[key]}, ${`Impersonation Tenant ${key.toUpperCase()}`}, 'active')
          RETURNING id`,
    );
    tenantIds[key] = inserted[0].id;
    // Distinct topN per tenant marks whose settings a request can see.
    await db.execute(
      sql`INSERT INTO user_settings
            (tenant_id, top_n, shortlist_size, ranking_prompt, shortlist_prompt,
             pipeline_time, email_time, linkedin_time, twitter_time,
             schedule_timezone)
          VALUES (${tenantIds[key]}::uuid, ${key === "a" ? 7 : 11}, 20,
                  'rank', 'shortlist', '09:00', '10:00', '10:15', '10:30', 'UTC')`,
    );
  }

  const superRow = await db.execute<{ id: string }>(
    sql`INSERT INTO users (tenant_id, email, password_hash, role)
        VALUES (NULL, ${SUPER_EMAIL}, 'x', 'super_admin')
        RETURNING id`,
  );
  superAdminId = superRow[0].id;
});

afterAll(cleanup);

function buildApp(): Hono {
  const app = new Hono();
  app.route(
    "/api/super-admin",
    createSuperAdminRouter({
      sessionSecret: SESSION_SECRET,
      getTenantsRepo: () => createTenantsRepo(db),
      getImpersonationEventsRepo: () => createImpersonationEventsRepo(db),
    }),
  );

  // A normal tenant route: settings for the EFFECTIVE tenant only.
  const tenantApp = new Hono<AuthEnv>();
  tenantApp.use("*", requireUser(SESSION_SECRET));
  tenantApp.get("/", async (c) => {
    const settings = await createUserSettingsRepo(db, getTenantId(c)).get();
    return c.json({ topN: settings?.topN ?? null });
  });
  app.route("/api/settings", tenantApp);
  return app;
}

function superCookie(): string {
  return `${COOKIE_NAME}=${issueSession(
    { uid: superAdminId, tid: null, role: "super_admin" },
    SESSION_SECRET,
  )}`;
}

function sessionTokenFrom(res: Response): string {
  const match = /(?:^|[;,]\s*)session=([^;]+)/.exec(
    res.headers.get("set-cookie") ?? "",
  );
  if (!match) throw new Error("no reissued session cookie");
  return match[1];
}

async function auditRows(): Promise<{ tenant_id: string; action: string }[]> {
  const rows = await db.execute<{ tenant_id: string; action: string }>(
    sql`SELECT tenant_id, action FROM impersonation_events
        WHERE super_admin_user_id = ${superAdminId}::uuid
        ORDER BY created_at, id`,
  );
  return [...rows];
}

describe("super-admin impersonation e2e", () => {
  it("REQ-101/103 + EDGE-008: impersonation scopes tenant routes to the target tenant and is audited", async () => {
    const app = buildApp();

    // GET /tenants lists both seeded tenants (REQ-100 data source).
    const listRes = await app.request("/api/super-admin/tenants", {
      headers: { cookie: superCookie() },
    });
    expect(listRes.status).toBe(200);
    const { tenants } = (await listRes.json()) as {
      tenants: { id: string; slug: string }[];
    };
    const slugs = tenants.map((t) => t.slug);
    expect(slugs).toContain(SLUGS.a);
    expect(slugs).toContain(SLUGS.b);

    // Impersonate tenant A → reissued cookie carries imp=A.
    const start = await app.request(
      `/api/super-admin/impersonate/${tenantIds.a}`,
      { method: "POST", headers: { cookie: superCookie() } },
    );
    expect(start.status).toBe(200);
    const impToken = sessionTokenFrom(start);
    expect(verifySession(impToken, SESSION_SECRET)?.imp).toBe(tenantIds.a);

    // The impersonated session sees TENANT A's data on a normal tenant route.
    const aData = await app.request("/api/settings", {
      headers: { cookie: `${COOKIE_NAME}=${impToken}` },
    });
    expect(aData.status).toBe(200);
    expect(await aData.json()).toEqual({ topN: 7 });

    // Exit → imp stripped; audit shows start then stop for tenant A.
    const exit = await app.request("/api/super-admin/exit-impersonation", {
      method: "POST",
      headers: { cookie: `${COOKIE_NAME}=${impToken}` },
    });
    expect(exit.status).toBe(200);
    const bareToken = sessionTokenFrom(exit);
    expect(verifySession(bareToken, SESSION_SECRET)?.imp).toBeUndefined();

    expect(await auditRows()).toEqual([
      { tenant_id: tenantIds.a, action: "start" },
      { tenant_id: tenantIds.a, action: "stop" },
    ]);
  });

  it("impersonating tenant B sees B's data, never A's", async () => {
    const app = buildApp();
    const start = await app.request(
      `/api/super-admin/impersonate/${tenantIds.b}`,
      { method: "POST", headers: { cookie: superCookie() } },
    );
    const impToken = sessionTokenFrom(start);
    const bData = await app.request("/api/settings", {
      headers: { cookie: `${COOKIE_NAME}=${impToken}` },
    });
    expect(await bData.json()).toEqual({ topN: 11 });
  });
});
