import { describe, it, expect, vi } from "vitest";
import {
  signupSchema,
  signup,
  EmailInUseError,
  type SignupDeps,
} from "../auth.js";
import type { UserRow, TenantRow } from "@newsletter/shared/db";

function makeUserRow(over: Partial<UserRow> = {}): UserRow {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    email: "ada@example.com",
    name: "Ada",
    passwordHash: "scrypt$N=16384,r=8,p=1$x$y",
    role: "tenant_admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeTenantRow(over: Partial<TenantRow> = {}): TenantRow {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    slug: "pending-abc123",
    name: "Ada",
    status: "pending_setup",
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeDeps(over: Partial<SignupDeps> = {}): SignupDeps {
  return {
    usersRepo: {
      findByEmail: vi.fn(() => Promise.resolve(null)),
      createWithTenant: vi.fn(() =>
        Promise.resolve({ user: makeUserRow(), tenant: makeTenantRow() }),
      ),
    },
    ...over,
  };
}

const VALID_INPUT = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  password: "correct-horse-9",
  confirmPassword: "correct-horse-9",
};

describe("signupSchema (REQ-002)", () => {
  it("test_REQ_002_rejects_password_mismatch", () => {
    const result = signupSchema.safeParse({
      ...VALID_INPUT,
      confirmPassword: "different-password",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issuePaths = result.error.issues.map((i) => i.path.join("."));
      expect(issuePaths).toContain("confirmPassword");
    }
  });

  it("accepts matching password + confirm", () => {
    expect(signupSchema.safeParse(VALID_INPUT).success).toBe(true);
  });

  it.each<{ name: string; patch: Record<string, unknown> }>([
    { name: "empty name", patch: { name: "" } },
    { name: "invalid email", patch: { email: "not-an-email" } },
    { name: "short password", patch: { password: "short", confirmPassword: "short" } },
  ])("rejects $name", ({ patch }) => {
    expect(signupSchema.safeParse({ ...VALID_INPUT, ...patch }).success).toBe(false);
  });

  it("test_REQ_006_signup_cannot_set_super_admin", () => {
    // A hostile payload smuggling a role field must not survive parsing.
    const parsed = signupSchema.parse({
      ...VALID_INPUT,
      role: "super_admin",
    } as Record<string, unknown>);
    expect("role" in parsed).toBe(false);
  });
});

describe("signup service", () => {
  it("creates the user via the tenant_admin-only repo seam (REQ-006)", async () => {
    const deps = makeDeps();
    await signup(deps, signupSchema.parse(VALID_INPUT));
    const call = vi.mocked(deps.usersRepo.createWithTenant).mock.calls[0][0];
    // The repo input has no role field at all — role is hardcoded inside the
    // repository as 'tenant_admin'; nothing in the signup path can set it.
    expect("role" in call).toBe(false);
    expect(call.email).toBe("ada@example.com");
    // Password is hashed before it crosses the repo seam (REQ-121).
    expect(call.passwordHash).toMatch(/^scrypt\$/);
    expect(call.passwordHash).not.toContain("correct-horse-9");
  });

  it("throws EmailInUseError when the email is already registered (REQ-003)", async () => {
    const deps = makeDeps({
      usersRepo: {
        findByEmail: vi.fn(() => Promise.resolve(makeUserRow())),
        createWithTenant: vi.fn(() =>
          Promise.reject(new Error("should not be called")),
        ),
      },
    });
    await expect(
      signup(deps, signupSchema.parse(VALID_INPUT)),
    ).rejects.toBeInstanceOf(EmailInUseError);
  });
});
