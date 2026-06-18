/**
 * Email-settings service (Fix #3, Phase B). Resolves and persists a tenant's
 * email provider mode:
 *   - `managed`        → shared verified Resend domain, `<slug>@<managed domain>`
 *   - `managed_domain` → tenant's OWN verified Resend domain (SendingDomainPanel)
 *   - `smtp`           → tenant's own provider via SMTP (secrets encrypted)
 *
 * SMTP secrets are encrypted with the D-012 credential cipher before they touch
 * the repo, and a connection check (`verifySmtp`) must pass before `smtp` mode
 * is activated. The browser only ever reads masked config (no password).
 */
import type { EmailProvider } from "@newsletter/shared";
import type { TenantRow } from "@newsletter/shared/db";
import type { CredentialCipher } from "@newsletter/shared/services";
import type {
  EmailMode,
  EmailSettingsWire,
  SmtpConfig,
  SmtpConfigStored,
  SmtpConfigWire,
  SmtpInput,
} from "@newsletter/shared/types/tenant";

export interface EmailSettingsTenantsRepo {
  findById(id: string): Promise<TenantRow | null>;
  updateEmailSettings(
    id: string,
    patch: { emailMode: EmailMode; smtpConfigEnc: SmtpConfigStored | null },
  ): Promise<TenantRow | null>;
}

export interface EmailSettingsServiceDeps {
  tenantsRepo: EmailSettingsTenantsRepo;
  cipher: CredentialCipher;
  /** Connection/credential check; throws on failure. Injected for tests. */
  verifySmtp: (config: SmtpConfig) => Promise<void>;
  /** Shared pre-verified sending domain for the managed default. */
  managedEmailDomain: string;
  /** Shared platform sender (grandfathered tenant 0 keeps this). */
  fromMail: string;
}

export interface EmailSettingsInput {
  mode: EmailMode;
  smtp?: SmtpInput;
}

export class EmailSettingsError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 502 = 400,
  ) {
    super(message);
    this.name = "EmailSettingsError";
  }
}

function maskSmtp(stored: SmtpConfigStored, cipher: CredentialCipher): SmtpConfigWire {
  // Password is the only true secret — masked to a boolean. The username
  // (e.g. an SES SMTP user) is config the owning tenant admin may see/edit.
  return {
    host: stored.host,
    port: stored.port,
    secure: stored.secure,
    username: cipher.decrypt(stored.username),
    fromAddress: stored.fromAddress,
    fromName: stored.fromName,
    passwordSet: true,
  };
}

/** The address the next broadcast would send from, given mode + state. */
function effectiveSender(
  tenant: TenantRow,
  managedEmailDomain: string,
  fromMail: string,
): string {
  if (tenant.emailMode === "smtp" && tenant.smtpConfigEnc !== null) {
    return tenant.smtpConfigEnc.fromAddress;
  }
  if (tenant.emailMode === "managed_domain" && tenant.sendingDomainName !== null) {
    return `newsletter@${tenant.sendingDomainName}`;
  }
  // managed: grandfathered tenant 0 (verified, no own domain name) keeps the
  // shared platform sender; everyone else uses the managed default.
  if (tenant.sendingDomainStatus === "verified" && tenant.sendingDomainName === null) {
    return fromMail;
  }
  return `${tenant.slug}@${managedEmailDomain}`;
}

/** Provider + FROM address for a single transactional (per-subscriber) send. */
export interface TransactionalSender {
  provider: EmailProvider;
  from: string;
}

export interface TransactionalSenderDeps {
  /** Shared, pre-verified provider (Resend/SES) for managed + managed_domain. */
  sharedProvider: EmailProvider;
  /** Platform sender — used with no tenant context and for grandfathered tenant 0. */
  fromMail: string;
  /** Shared pre-verified sending domain backing the managed default sender. */
  managedEmailDomain: string;
  cipher: CredentialCipher;
  /** Builds a per-tenant SMTP provider from decrypted creds (smtp mode). */
  createSmtpProvider: (config: SmtpConfig) => EmailProvider;
}

/**
 * Resolves the sender for a SUBSCRIBER-FACING transactional email (subscribe
 * confirmation, welcome). Unlike the digest broadcast, transactional mail must
 * ALWAYS deliver — bootstrapping a list depends on the confirmation arriving —
 * so an unverified custom domain GRACEFULLY FALLS BACK to the managed default
 * (`<slug>@<managed domain>`, on the always-verified shared domain) rather than
 * failing closed. Mirrors the broadcast cascade in pipeline `email-send.ts`,
 * minus the fail-closed block.
 */
export function resolveTransactionalSender(
  tenant: TenantRow | null,
  deps: TransactionalSenderDeps,
): TransactionalSender {
  // No tenant context (app host / legacy single-tenant) → platform sender.
  if (tenant === null) {
    return { provider: deps.sharedProvider, from: deps.fromMail };
  }
  // smtp: relay through the tenant's own provider/domain (verified at activation
  // via verifySmtp; they own SPF/DKIM so DMARC passes only via their server).
  if (tenant.emailMode === "smtp" && tenant.smtpConfigEnc !== null) {
    const enc = tenant.smtpConfigEnc;
    const config: SmtpConfig = {
      host: enc.host,
      port: enc.port,
      secure: enc.secure,
      fromAddress: enc.fromAddress,
      fromName: enc.fromName,
      username: deps.cipher.decrypt(enc.username),
      password: deps.cipher.decrypt(enc.password),
    };
    return { provider: deps.createSmtpProvider(config), from: enc.fromAddress };
  }
  // managed_domain: only when the tenant's own domain is VERIFIED; otherwise
  // fall through to the managed default (never route transactional mail through
  // an unverified domain — it would bounce and block signup).
  if (
    tenant.emailMode === "managed_domain" &&
    tenant.sendingDomainStatus === "verified" &&
    tenant.sendingDomainName !== null
  ) {
    return {
      provider: deps.sharedProvider,
      from: `newsletter@${tenant.sendingDomainName}`,
    };
  }
  // Grandfathered tenant 0 (managed, verified, no own domain) → platform sender.
  if (tenant.sendingDomainStatus === "verified" && tenant.sendingDomainName === null) {
    return { provider: deps.sharedProvider, from: deps.fromMail };
  }
  // Managed default (zero-config) — also the graceful fallback for an unverified
  // managed_domain tenant. Rides the shared, pre-verified domain.
  return {
    provider: deps.sharedProvider,
    from: `${tenant.slug}@${deps.managedEmailDomain}`,
  };
}

export function emailSettingsFromTenant(
  tenant: TenantRow,
  managedEmailDomain: string,
  fromMail: string,
  cipher: CredentialCipher,
): EmailSettingsWire {
  return {
    mode: tenant.emailMode,
    effectiveSender: effectiveSender(tenant, managedEmailDomain, fromMail),
    smtp:
      tenant.emailMode === "smtp" && tenant.smtpConfigEnc !== null
        ? maskSmtp(tenant.smtpConfigEnc, cipher)
        : null,
  };
}

export async function getEmailSettings(
  deps: EmailSettingsServiceDeps,
  tenantId: string,
): Promise<EmailSettingsWire> {
  const tenant = await deps.tenantsRepo.findById(tenantId);
  if (tenant === null) throw new EmailSettingsError("tenant not found", 404);
  return emailSettingsFromTenant(
    tenant,
    deps.managedEmailDomain,
    deps.fromMail,
    deps.cipher,
  );
}

export async function updateEmailSettings(
  deps: EmailSettingsServiceDeps,
  tenantId: string,
  input: EmailSettingsInput,
): Promise<EmailSettingsWire> {
  const tenant = await deps.tenantsRepo.findById(tenantId);
  if (tenant === null) throw new EmailSettingsError("tenant not found", 404);

  if (input.mode === "smtp") {
    const stored = buildSmtpConfigEnc(deps, tenant, input.smtp);
    const decrypted: SmtpConfig = {
      host: stored.host,
      port: stored.port,
      secure: stored.secure,
      fromAddress: stored.fromAddress,
      fromName: stored.fromName,
      username: deps.cipher.decrypt(stored.username),
      password: deps.cipher.decrypt(stored.password),
    };
    try {
      await deps.verifySmtp(decrypted);
    } catch (err) {
      throw new EmailSettingsError(
        `SMTP connection failed: ${err instanceof Error ? err.message : "unknown error"}`,
        502,
      );
    }
    const updated = await deps.tenantsRepo.updateEmailSettings(tenantId, {
      emailMode: "smtp",
      smtpConfigEnc: stored,
    });
    return finalize(deps, updated);
  }

  // managed / managed_domain: clear any stored SMTP config.
  const updated = await deps.tenantsRepo.updateEmailSettings(tenantId, {
    emailMode: input.mode,
    smtpConfigEnc: null,
  });
  return finalize(deps, updated);
}

function buildSmtpConfigEnc(
  deps: EmailSettingsServiceDeps,
  tenant: TenantRow,
  smtp: SmtpInput | undefined,
): SmtpConfigStored {
  if (smtp === undefined) {
    throw new EmailSettingsError("smtp config is required for smtp mode", 400);
  }
  // Password: use the new value if provided, else reuse the stored one.
  let passwordBlob: SmtpConfigStored["password"];
  if (smtp.password !== undefined && smtp.password.length > 0) {
    passwordBlob = deps.cipher.encrypt(smtp.password);
  } else if (
    tenant.emailMode === "smtp" &&
    tenant.smtpConfigEnc !== null
  ) {
    passwordBlob = tenant.smtpConfigEnc.password;
  } else {
    throw new EmailSettingsError("smtp password is required", 400);
  }
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    fromAddress: smtp.fromAddress,
    fromName: smtp.fromName,
    username: deps.cipher.encrypt(smtp.username),
    password: passwordBlob,
  };
}

function finalize(
  deps: EmailSettingsServiceDeps,
  updated: TenantRow | null,
): EmailSettingsWire {
  if (updated === null) throw new EmailSettingsError("tenant not found", 404);
  return emailSettingsFromTenant(
    updated,
    deps.managedEmailDomain,
    deps.fromMail,
    deps.cipher,
  );
}
