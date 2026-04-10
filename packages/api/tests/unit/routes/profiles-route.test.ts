import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createProfilesRouter } from "@api/routes/profiles.js";

function makeApp(listProfiles: () => Promise<string[]>): Hono {
  const app = new Hono();
  app.route("/api/profiles", createProfilesRouter({ listProfiles }));
  return app;
}

describe("GET /api/profiles", () => {
  it("REQ-007: returns { profiles: string[] } from listProfiles", async () => {
    const stub = vi.fn().mockResolvedValue(["alice", "bob"]);
    const app = makeApp(stub);
    const res = await app.request("/api/profiles");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profiles: string[] };
    expect(body).toEqual({ profiles: ["alice", "bob"] });
    expect(stub).toHaveBeenCalledOnce();
  });

  it("EDGE-017: returns { profiles: [] } for empty dir", async () => {
    const stub = vi.fn().mockResolvedValue([]);
    const app = makeApp(stub);
    const res = await app.request("/api/profiles");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profiles: string[] };
    expect(body).toEqual({ profiles: [] });
  });
});
