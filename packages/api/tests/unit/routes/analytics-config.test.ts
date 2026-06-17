import { describe, expect, it } from "vitest";
import { createAnalyticsConfigRouter } from "@api/routes/analytics-config.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";
import type { UserSettings } from "@newsletter/shared";

function makeSettings(
  overrides: Partial<UserSettings> = {},
): UserSettings {
  return {
    id: "settings-1",
    topN: 10,
    halfLifeHours: null,
    hnEnabled: true,
    hnConfig: { sinceDays: 1 },
    redditEnabled: false,
    redditConfig: null,
    webEnabled: false,
    webConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: null,
    scheduleTime: "09:30",
    scheduleTimezone: "UTC",
    scheduleEnabled: false,
    updatedAt: new Date("2026-05-18T00:00:00Z").toISOString(),
    ...overrides,
  };
}

function makeRepo(settings: UserSettings | null): UserSettingsRepo {
  return {
    get: () => Promise.resolve(settings),
    upsert: () => Promise.reject(new Error("not used")),
  };
}

describe("GET /api/public/analytics-config", () => {
  it("returns disabled config when settings are absent and no env fallback exists", async () => {
    const app = createAnalyticsConfigRouter({
      getSettingsRepo: () => makeRepo(null),
    });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
    });
  });

  it("returns token and host when PostHog is enabled in settings", async () => {
    const app = createAnalyticsConfigRouter({
      getSettingsRepo: () =>
        makeRepo(
          makeSettings({
            posthogEnabled: true,
            posthogProjectToken: "phc_project_token",
            posthogHost: "https://us.i.posthog.com",
          }),
        ),
    });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      posthogEnabled: true,
      posthogProjectToken: "phc_project_token",
      posthogHost: "https://us.i.posthog.com",
    });
  });

  it("returns disabled config when PostHog settings are incomplete", async () => {
    const app = createAnalyticsConfigRouter({
      getSettingsRepo: () =>
        makeRepo(
          makeSettings({
            posthogEnabled: true,
            posthogProjectToken: null,
            posthogHost: "https://us.i.posthog.com",
          }),
        ),
    });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
    });
  });
});


describe("tenant scoping", () => {
  it("passes the Host-resolved public tenant scope to the settings repo factory", async () => {
    const TENANT_X = "11111111-1111-1111-1111-111111111111";
    const scopes: unknown[] = [];
    const { Hono } = await import("hono");
    const outer = new Hono();
    outer.use("*", async (c, next) => {
      c.set("publicTenant", { tenantId: TENANT_X, slug: "x", featureCanon: false });
      await next();
    });
    outer.route(
      "/",
      createAnalyticsConfigRouter({
        getSettingsRepo: (scope?: unknown) => {
          scopes.push(scope);
          return makeRepo(null);
        },
      }),
    );
    const res = await outer.request("/");
    expect(res.status).toBe(200);
    expect(scopes).toEqual([{ tenantId: TENANT_X, role: "tenant_admin" }]);
  });
});
