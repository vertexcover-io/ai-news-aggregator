/**
 * /api/extension router — email+password login (tenant_admin only in v1),
 * super_admin rejection, bearer-gated submissions, and the tenant scope that
 * flows from the token into the repo factory. CORS is scoped to
 * chrome-extension:// origins.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  createExtensionRouter,
  type ExtensionRouterDeps,
} from "@api/routes/extension.js";
import { issueExtensionToken, verifyExtensionToken } from "@api/auth/extension-token.js";
import { hashPassword } from "@api/services/password.js";
import type { UserRow } from "@newsletter/shared/db";
import type { TenantScope } from "@newsletter/shared/db";
import type { SubmissionRawItemsRepo } from "@api/services/user-submissions.js";

const SECRET = "ext-route-secret";
const PASSWORD = "correct-horse";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

let tenantAdmin: UserRow;
let superUser: UserRow;

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const base = {
    email: "admin@acme.test",
    name: "Acme Admin",
    passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  tenantAdmin = {
    ...base,
    id: "user-ta",
    tenantId: TENANT_ID,
    role: "tenant_admin",
  };
  superUser = {
    ...base,
    id: "user-super",
    email: "root@platform.test",
    tenantId: null,
    role: "super_admin",
  };
});

function okRepo(): SubmissionRawItemsRepo {
  let row: { id: number; url: string; title: string } | null = null;
  return {
    findBySourceAndExternalId: vi.fn(() => Promise.resolve(row)),
    upsertItems: vi.fn((items: { url: string; title: string }[]) => {
      const i = items[0];
      if (i) row = { id: 1, url: i.url, title: i.title };
      return Promise.resolve();
    }),
  };
}

function makeRouter(
  overrides: Partial<ExtensionRouterDeps> = {},
): { router: ReturnType<typeof createExtensionRouter>; scopes: (TenantScope | undefined)[] } {
  const scopes: (TenantScope | undefined)[] = [];
  const router = createExtensionRouter({
    sessionSecret: SECRET,
    getUsersRepo: () => ({
      findByEmail: (email: string) =>
        Promise.resolve(
          email === tenantAdmin.email
            ? tenantAdmin
            : email === superUser.email
              ? superUser
              : null,
        ),
    }),
    getRawItemsRepo: (scope) => {
      scopes.push(scope);
      return okRepo();
    },
    canonicalizeUrl: (u) => u,
    enrichUrl: () => Promise.resolve({}),
    ...overrides,
  });
  return { router, scopes };
}

function postJson(
  router: ReturnType<typeof createExtensionRouter>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    router.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /login", () => {
  it("issues a tenant-scoped token for a tenant_admin", async () => {
    const { router } = makeRouter();
    const res = await postJson(router, "/login", {
      email: tenantAdmin.email,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { tenantId: string } };
    expect(verifyExtensionToken(body.token, SECRET)).toEqual({
      userId: "user-ta",
      tenantId: TENANT_ID,
      role: "tenant_admin",
    });
    expect(body.user.tenantId).toBe(TENANT_ID);
  });

  it("401s on a wrong password and an unknown email", async () => {
    const { router } = makeRouter();
    expect(
      (await postJson(router, "/login", { email: tenantAdmin.email, password: "nope" })).status,
    ).toBe(401);
    expect(
      (await postJson(router, "/login", { email: "ghost@x.test", password: PASSWORD })).status,
    ).toBe(401);
  });

  it("403 select_tenant for a super_admin (v1 scope)", async () => {
    const { router } = makeRouter();
    const res = await postJson(router, "/login", {
      email: superUser.email,
      password: PASSWORD,
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: "select_tenant",
    });
  });

  it("400 on an invalid body", async () => {
    const { router } = makeRouter();
    expect((await postJson(router, "/login", { email: "not-an-email" })).status).toBe(400);
  });
});

describe("POST /submissions", () => {
  it("401s without a bearer token", async () => {
    const { router } = makeRouter();
    expect(
      (await postJson(router, "/submissions", { url: "https://x.com/p" })).status,
    ).toBe(401);
  });

  it("201s and scopes the repo to the token's tenant", async () => {
    const { router, scopes } = makeRouter();
    const token = issueExtensionToken(
      { userId: "user-ta", tenantId: TENANT_ID, role: "tenant_admin" },
      SECRET,
    );
    const res = await postJson(
      router,
      "/submissions",
      { url: "https://x.com/p", title: "Hi" },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(201);
    expect((await res.json()) as { sourceType: string }).toMatchObject({
      sourceType: "manual",
    });
    // The repo was built with a concrete tenant scope from the token.
    expect(scopes.at(-1)).toMatchObject({ tenantId: TENANT_ID });
  });
});

describe("CORS", () => {
  it("allows chrome-extension:// origins on preflight", async () => {
    const { router } = makeRouter();
    const res = await router.request("/login", {
      method: "OPTIONS",
      headers: {
        Origin: "chrome-extension://abcdef",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "chrome-extension://abcdef",
    );
  });
});
