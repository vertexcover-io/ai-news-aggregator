import { describe, it, expect, vi } from "vitest";
import { seedAdminUser } from "../admin-seed.js";
import type { TenantRow, UserRow } from "@newsletter/shared/db";

const TENANT: TenantRow = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  slug: "agentloop",
  previousSlug: null,
  name: "AGENTLOOP",
  status: "active",
  customDomain: null,
  headline: null,
  topicStrip: null,
  subtagline: null,
  logoBytes: null,
  logoContentType: null,
  featureCanon: false,
  featureDeliverability: false,
  featureEval: false,
  onboardingState: null,
  sendingDomainName: null,
  sendingDomainId: null,
  sendingDomainStatus: null,
  sendingDomainRecords: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("seedAdminUser (bootstrap — existing admin stays reachable)", () => {
  it("creates the tenant_admin when no users exist", async () => {
    const create = vi.fn((input: { role: string }) =>
      Promise.resolve({ role: input.role } as UserRow),
    );
    const deps = {
      usersRepo: { countAll: vi.fn(() => Promise.resolve(0)), create },
      tenantsRepo: {
        findBySlug: vi.fn(() => Promise.resolve<TenantRow | null>(TENANT)),
        create: vi.fn(() => Promise.resolve(TENANT)),
      },
    };
    const seeded = await seedAdminUser(deps, {
      email: "admin@agentloop.dev",
      password: "vertexcover@123",
    });
    expect(seeded).toBe(true);
    const input = create.mock.calls[0][0] as Record<string, unknown>;
    expect(input.role).toBe("tenant_admin");
    expect(input.tenantId).toBe(TENANT.id);
    expect(input.passwordHash).toMatch(/^scrypt\$/);
    expect(input.passwordHash).not.toContain("vertexcover@123");
  });

  it("creates the agentloop tenant if it does not exist yet", async () => {
    const tenantCreate = vi.fn(() => Promise.resolve(TENANT));
    const deps = {
      usersRepo: {
        countAll: vi.fn(() => Promise.resolve(0)),
        create: vi.fn(() => Promise.resolve({} as UserRow)),
      },
      tenantsRepo: {
        findBySlug: vi.fn(() => Promise.resolve<TenantRow | null>(null)),
        create: tenantCreate,
      },
    };
    await seedAdminUser(deps, { email: "a@b.co", password: "x-long-enough" });
    expect(tenantCreate).toHaveBeenCalledWith({
      slug: "agentloop",
      name: "AGENTLOOP",
      status: "active",
    });
  });

  it("is a no-op when any user already exists", async () => {
    const create = vi.fn(() => Promise.resolve({} as UserRow));
    const deps = {
      usersRepo: { countAll: vi.fn(() => Promise.resolve(3)), create },
      tenantsRepo: {
        findBySlug: vi.fn(() => Promise.resolve<TenantRow | null>(TENANT)),
        create: vi.fn(() => Promise.resolve(TENANT)),
      },
    };
    const seeded = await seedAdminUser(deps, {
      email: "a@b.co",
      password: "x-long-enough",
    });
    expect(seeded).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
