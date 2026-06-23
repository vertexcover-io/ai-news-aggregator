/**
 * Email-settings service (Fix #3, Phase B): mode switching, SMTP encrypt-on-
 * write + masked read, connection-check gating. No real SMTP — `verifySmtp`
 * is a fake.
 */
import { describe, expect, it, vi } from "vitest";
import type { TenantRow } from "@newsletter/shared/db";
import type { CredentialCipher } from "@newsletter/shared/services";
import type { EmailProvider } from "@newsletter/shared";
import {
  EmailSettingsError,
  getEmailSettings,
  resolveTransactionalSender,
  updateEmailSettings,
  type EmailSettingsServiceDeps,
} from "../../../src/services/email-settings";

// Fake cipher: base64 so ciphertext ≠ plaintext (assert "not plaintext") while
// still round-tripping decrypt.
const cipher: CredentialCipher = {
  encrypt: (s: string) => ({ ct: Buffer.from(s, "utf8").toString("base64"), iv: "iv", tag: "tag" }),
  decrypt: (b) => Buffer.from(b.ct, "base64").toString("utf8"),
};

function tenant(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: "t1",
    slug: "inference",
    emailMode: "managed",
    smtpConfigEnc: null,
    sendingDomainName: null,
    sendingDomainStatus: null,
    ...overrides,
  } as unknown as TenantRow;
}

function makeDeps(
  initial: TenantRow,
  verifySmtp = vi.fn(() => Promise.resolve()),
): {
  deps: EmailSettingsServiceDeps;
  updateEmailSettings: ReturnType<typeof vi.fn>;
  verifySmtp: ReturnType<typeof vi.fn>;
} {
  let row = initial;
  const update = vi.fn((_id: string, patch: { emailMode: string; smtpConfigEnc: unknown }) => {
    row = { ...row, ...patch } as TenantRow;
    return Promise.resolve(row);
  });
  return {
    deps: {
      tenantsRepo: {
        findById: vi.fn(() => Promise.resolve(row)),
        updateEmailSettings: update as never,
      },
      cipher,
      verifySmtp,
      managedEmailDomain: "news.vertexcover.io",
      fromMail: "newsletter@news.vertexcover.io",
    },
    updateEmailSettings: update,
    verifySmtp,
  };
}

describe("email-settings service", () => {
  it("managed mode → effective sender is <slug>@<managed domain>", async () => {
    const { deps } = makeDeps(tenant({ emailMode: "managed" }));
    const wire = await getEmailSettings(deps, "t1");
    expect(wire.mode).toBe("managed");
    expect(wire.effectiveSender).toBe("inference@news.vertexcover.io");
    expect(wire.smtp).toBeNull();
  });

  it("grandfathered tenant 0 (verified, no domain name) → shared platform sender", async () => {
    const { deps } = makeDeps(
      tenant({ emailMode: "managed", sendingDomainStatus: "verified", sendingDomainName: null }),
    );
    const wire = await getEmailSettings(deps, "t1");
    expect(wire.effectiveSender).toBe("newsletter@news.vertexcover.io");
  });

  it("managed_domain → newsletter@<domain>", async () => {
    const { deps } = makeDeps(
      tenant({ emailMode: "managed_domain", sendingDomainName: "news.acme.com" }),
    );
    const wire = await getEmailSettings(deps, "t1");
    expect(wire.effectiveSender).toBe("newsletter@news.acme.com");
  });

  it("switching to smtp encrypts secrets, runs the connection check, and masks the password on read", async () => {
    const { deps, updateEmailSettings: update, verifySmtp } = makeDeps(tenant());
    const wire = await updateEmailSettings(deps, "t1", {
      mode: "smtp",
      smtp: {
        host: "smtp.acme.com",
        port: 587,
        secure: false,
        username: "AKIA-user",
        password: "s3cret",
        fromAddress: "news@acme.com",
      },
    });

    expect(verifySmtp).toHaveBeenCalledOnce();
    const patch = update.mock.calls[0]?.[1] as { emailMode: string; smtpConfigEnc: { password: { ct: string }; username: { ct: string } } };
    expect(patch.emailMode).toBe("smtp");
    // Secrets are ciphertext at rest, never plaintext.
    expect(patch.smtpConfigEnc.password.ct).not.toContain("s3cret");
    expect(cipher.decrypt(patch.smtpConfigEnc.password)).toBe("s3cret");
    expect(cipher.decrypt(patch.smtpConfigEnc.username)).toBe("AKIA-user");
    // Read-back: password masked to a boolean, username surfaced, sender = from.
    expect(wire.mode).toBe("smtp");
    expect(wire.smtp).toEqual(
      expect.objectContaining({ host: "smtp.acme.com", username: "AKIA-user", passwordSet: true }),
    );
    expect(wire.effectiveSender).toBe("news@acme.com");
  });

  it("a failed SMTP connection check is a 502 and does NOT switch the mode", async () => {
    const verifySmtp = vi.fn(() => Promise.reject(new Error("auth failed")));
    const { deps, updateEmailSettings: update } = makeDeps(tenant({ emailMode: "managed" }), verifySmtp);

    await expect(
      updateEmailSettings(deps, "t1", {
        mode: "smtp",
        smtp: {
          host: "smtp.acme.com",
          port: 587,
          secure: false,
          username: "u",
          password: "p",
          fromAddress: "news@acme.com",
        },
      }),
    ).rejects.toMatchObject({ status: 502 });
    expect(update).not.toHaveBeenCalled();
  });

  it("smtp mode without a password (and none stored) is rejected", async () => {
    const { deps } = makeDeps(tenant());
    await expect(
      updateEmailSettings(deps, "t1", {
        mode: "smtp",
        smtp: {
          host: "smtp.acme.com",
          port: 587,
          secure: false,
          username: "u",
          fromAddress: "news@acme.com",
        },
      }),
    ).rejects.toBeInstanceOf(EmailSettingsError);
  });

  it("switching away from smtp clears the stored SMTP config", async () => {
    const { deps, updateEmailSettings: update } = makeDeps(
      tenant({
        emailMode: "smtp",
        smtpConfigEnc: {
          host: "h",
          port: 587,
          secure: false,
          fromAddress: "n@acme.com",
          username: { ct: "enc(u)", iv: "iv", tag: "tag" },
          password: { ct: "enc(p)", iv: "iv", tag: "tag" },
        },
      }),
    );
    await updateEmailSettings(deps, "t1", { mode: "managed" });
    const patch = update.mock.calls[0]?.[1] as { emailMode: string; smtpConfigEnc: unknown };
    expect(patch.emailMode).toBe("managed");
    expect(patch.smtpConfigEnc).toBeNull();
  });
});

// resolveTransactionalSender (subscriber-facing confirmation/welcome): mirrors
// the broadcast cascade but NEVER blocks — an unverified custom domain falls
// back to the managed default so the confirmation always delivers.
describe("resolveTransactionalSender", () => {
  const sharedProvider: EmailProvider = {
    send: vi.fn(() => Promise.resolve({ messageId: "shared" })),
  };
  const smtpProvider: EmailProvider = {
    send: vi.fn(() => Promise.resolve({ messageId: "smtp" })),
  };
  const createSmtpProvider = vi.fn(() => smtpProvider);
  const senderDeps = {
    sharedProvider,
    fromMail: "newsletter@news.vertexcover.io",
    managedEmailDomain: "news.vertexcover.io",
    cipher,
    createSmtpProvider,
  };

  it("no tenant context → shared provider + platform sender", () => {
    const { provider, from } = resolveTransactionalSender(null, senderDeps);
    expect(provider).toBe(sharedProvider);
    expect(from).toBe("newsletter@news.vertexcover.io");
  });

  it("managed mode → shared provider + managed default <slug>@<managed domain>", () => {
    const { provider, from } = resolveTransactionalSender(
      tenant({ emailMode: "managed", slug: "inference" }),
      senderDeps,
    );
    expect(provider).toBe(sharedProvider);
    expect(from).toBe("inference@news.vertexcover.io");
  });

  it("grandfathered tenant 0 (managed, verified, no domain name) → platform sender", () => {
    const { from } = resolveTransactionalSender(
      tenant({ emailMode: "managed", sendingDomainStatus: "verified", sendingDomainName: null }),
      senderDeps,
    );
    expect(from).toBe("newsletter@news.vertexcover.io");
  });

  it("managed_domain VERIFIED → newsletter@<tenant domain>", () => {
    const { provider, from } = resolveTransactionalSender(
      tenant({
        emailMode: "managed_domain",
        sendingDomainName: "news.acme.com",
        sendingDomainStatus: "verified",
      }),
      senderDeps,
    );
    expect(provider).toBe(sharedProvider);
    expect(from).toBe("newsletter@news.acme.com");
  });

  it.each(["pending", "failed", null] as const)(
    "managed_domain UNVERIFIED (%s) → falls back to the managed default, never the bare custom domain",
    (status) => {
      const { provider, from } = resolveTransactionalSender(
        tenant({
          emailMode: "managed_domain",
          slug: "inference",
          sendingDomainName: "news.acme.com",
          sendingDomainStatus: status,
        }),
        senderDeps,
      );
      expect(provider).toBe(sharedProvider);
      expect(from).toBe("inference@news.vertexcover.io");
    },
  );

  it("smtp mode → per-tenant SMTP provider + the tenant's own From address", () => {
    const { provider, from } = resolveTransactionalSender(
      tenant({
        emailMode: "smtp",
        smtpConfigEnc: {
          host: "smtp.acme.com",
          port: 587,
          secure: false,
          fromAddress: "news@acme.com",
          fromName: undefined,
          username: cipher.encrypt("user"),
          password: cipher.encrypt("pass"),
        },
      }),
      senderDeps,
    );
    expect(provider).toBe(smtpProvider);
    expect(from).toBe("news@acme.com");
    expect(createSmtpProvider).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.acme.com", username: "user", password: "pass" }),
    );
  });
});
