import { Hono } from "hono";
import { Resend } from "resend";
import { getDb as defaultGetDb } from "@newsletter/shared";
import { z } from "zod";
import type { TenantVariables } from "@api/middleware/types.js";
import {
  createSendingDomainsRepo,
  type SendingDomainsRepo,
} from "@api/repositories/sending-domains.js";
import type {
  SendingDomainRow,
  SendingDomainStatus,
  TenantContext,
} from "@newsletter/shared";

const registerDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^(?!-)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, {
      message: "domain must be a valid hostname",
    }),
});

interface ResendDomainRecord {
  record: string;
  name: string;
  type: string;
  ttl?: string;
  status: string;
  value: string;
  priority?: number;
}

interface ResendCreateSuccess {
  id: string;
  status: string;
  records: ResendDomainRecord[];
}

interface ResendGetSuccess {
  id: string;
  status: string;
  records: ResendDomainRecord[];
}

interface ResendError {
  message: string;
  name: string;
}

export interface ResendDomainsClient {
  create(payload: {
    name: string;
  }): Promise<{ data: ResendCreateSuccess | null; error: ResendError | null }>;
  get(
    id: string,
  ): Promise<{ data: ResendGetSuccess | null; error: ResendError | null }>;
}

export interface SendingDomainsRouterDeps {
  getRepo: (ctx: TenantContext) => SendingDomainsRepo;
  /**
   * Resend domains client. Returns null when RESEND_API_KEY is unset, in which
   * case domain registration/verification is unavailable (501).
   */
  getResend: () => ResendDomainsClient | null;
}

// Map Resend's richer status set onto our four-state model.
function mapResendStatus(status: string): SendingDomainStatus {
  if (status === "verified") return "verified";
  if (status === "failed" || status === "partially_failed") return "failed";
  return "pending";
}

function failureReasonsFromRecords(
  records: ResendDomainRecord[],
): string[] | null {
  const reasons = records
    .filter((r) => r.status === "failed" || r.status === "temporary_failure")
    .map((r) => `${r.type} ${r.name}: ${r.status}`);
  return reasons.length > 0 ? reasons : null;
}

function serializeDomain(row: SendingDomainRow): {
  domain: string;
  status: SendingDomainStatus;
  dnsRecords: unknown[] | null;
  failureReasons: string[] | null;
  verified: boolean;
  updatedAt: string;
} {
  return {
    domain: row.domain,
    status: row.status,
    dnsRecords: row.dnsRecords,
    failureReasons: row.failureReasons,
    verified: row.status === "verified",
    updatedAt: row.updatedAt.toISOString(),
  };
}

function requireCtx(c: {
  get: (key: "tenantCtx") => TenantContext | undefined;
}): TenantContext | null {
  return c.get("tenantCtx") ?? null;
}

export function createSendingDomainsRouter(
  deps: SendingDomainsRouterDeps,
): Hono<{ Variables: TenantVariables }> {
  const app = new Hono<{ Variables: TenantVariables }>();

  app.get("/", async (c) => {
    const ctx = requireCtx(c);
    if (!ctx) return c.json({ error: "unauthorized" }, 401);
    const row = await deps.getRepo(ctx).get();
    if (!row) {
      return c.json({ domain: null, status: "none", verified: false });
    }
    return c.json(serializeDomain(row));
  });

  app.post("/", async (c) => {
    const ctx = requireCtx(c);
    if (!ctx) return c.json({ error: "unauthorized" }, 401);

    const body: unknown = await c.req.json().catch(() => null);
    const parsed = registerDomainSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", issues: parsed.error.issues },
        400,
      );
    }

    const resend = deps.getResend();
    if (!resend) {
      return c.json(
        { error: "resend_unavailable", message: "RESEND_API_KEY not configured" },
        501,
      );
    }

    const { data, error } = await resend.create({ name: parsed.data.domain });
    if (error || !data) {
      return c.json(
        { error: "resend_error", message: error?.message ?? "unknown error" },
        502,
      );
    }

    const row = await deps.getRepo(ctx).upsert({
      domain: parsed.data.domain,
      providerDomainId: data.id,
      status: mapResendStatus(data.status),
      dnsRecords: data.records,
      failureReasons: null,
    });
    return c.json(serializeDomain(row));
  });

  app.post("/verify", async (c) => {
    const ctx = requireCtx(c);
    if (!ctx) return c.json({ error: "unauthorized" }, 401);

    const repo = deps.getRepo(ctx);
    const existing = await repo.get();
    if (!existing?.providerDomainId) {
      return c.json({ error: "no_domain", message: "no domain registered" }, 404);
    }

    const resend = deps.getResend();
    if (!resend) {
      return c.json(
        { error: "resend_unavailable", message: "RESEND_API_KEY not configured" },
        501,
      );
    }

    const { data, error } = await resend.get(existing.providerDomainId);
    if (error || !data) {
      return c.json(
        { error: "resend_error", message: error?.message ?? "unknown error" },
        502,
      );
    }

    const status = mapResendStatus(data.status);
    const row = await repo.updateStatus(status, {
      dnsRecords: data.records,
      failureReasons:
        status === "failed" ? failureReasonsFromRecords(data.records) : null,
    });
    return c.json(serializeDomain(row));
  });

  return app;
}

function getDefaultResend(): ResendDomainsClient | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  const client = new Resend(key);
  return {
    create: (payload) =>
      client.domains.create(payload) as ReturnType<
        ResendDomainsClient["create"]
      >,
    get: (id) =>
      client.domains.get(id) as ReturnType<ResendDomainsClient["get"]>,
  };
}

export function createDefaultSendingDomainsRouter(): Hono<{
  Variables: TenantVariables;
}> {
  return createSendingDomainsRouter({
    getRepo: (ctx) => createSendingDomainsRepo(defaultGetDb(), ctx),
    getResend: getDefaultResend,
  });
}
