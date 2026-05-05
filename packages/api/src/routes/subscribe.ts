import { Hono } from "hono";
import { z } from "zod";
import { issueSubscriberToken, verifySubscriberToken } from "@api/lib/subscriber-token.js";
import type { SubscribersRepo } from "@api/repositories/subscribers.js";

export interface SubscribeRouterDeps {
  subscribersRepo: SubscribersRepo;
  sessionSecret: string;
  baseUrl: string;
  webBaseUrl: string;
  sendConfirmationEmail: (email: string, confirmUrl: string) => Promise<void>;
  sendNewsletterToSubscriber: (runId: string, subscriberId: string) => Promise<void>;
  getTodaysReviewedArchiveId: () => Promise<string | null>;
}

const subscribeBodySchema = z.object({
  email: z.email().max(254),
});

export function createSubscribeRouter(deps: SubscribeRouterDeps): Hono {
  const app = new Hono();

  app.post("/subscribe", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = subscribeBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const { email } = parsed.data;
    const existing = await deps.subscribersRepo.findByEmail(email);
    if (existing) {
      return c.json({ ok: true });
    }

    let subscriber;
    try {
      subscriber = await deps.subscribersRepo.create({
        email,
        status: "pending",
      });
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === "23505") {
        return c.json({ ok: true });
      }
      throw err;
    }

    const confirmTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const confirmToken = issueSubscriberToken(
      subscriber.id,
      "confirm",
      deps.sessionSecret,
      confirmTokenExpiresAt,
    );

    await deps.subscribersRepo.updateConfirmToken(
      subscriber.id,
      confirmToken,
      confirmTokenExpiresAt,
    );

    const confirmUrl = `${deps.baseUrl}/api/confirm?token=${confirmToken}`;
    try {
      await deps.sendConfirmationEmail(email, confirmUrl);
    } catch {
      // Email send failures (provider rejection, rate limit, transient outage)
      // must not surface as 500: the subscriber is persisted in pending state
      // and can be re-sent via admin tools or retried.
    }

    return c.json({ ok: true });
  });

  app.get("/confirm", async (c) => {
    const token = c.req.query("token") ?? "";
    const result = verifySubscriberToken(token, "confirm", deps.sessionSecret);

    if (!result.valid) {
      if (result.reason === "expired") {
        return c.redirect(`${deps.webBaseUrl}/confirm?status=expired`);
      }
      if (result.reason === "wrong-type") {
        return c.redirect(`${deps.webBaseUrl}/confirm?status=invalid`);
      }
      return c.redirect(`${deps.webBaseUrl}/confirm?status=invalid`);
    }

    await deps.subscribersRepo.updateStatus(result.subscriberId, "confirmed", {
      subscribedAt: new Date(),
      confirmToken: null,
      confirmTokenExpiresAt: null,
    });

    const todaysArchiveId = await deps.getTodaysReviewedArchiveId();
    if (todaysArchiveId) {
      await deps.sendNewsletterToSubscriber(todaysArchiveId, result.subscriberId);
    }

    return c.redirect(`${deps.webBaseUrl}/confirm?status=success`);
  });

  app.get("/unsubscribe", async (c) => {
    const token = c.req.query("token") ?? "";
    const result = verifySubscriberToken(token, "unsub", deps.sessionSecret);

    if (result.valid) {
      await deps.subscribersRepo.updateStatus(result.subscriberId, "unsubscribed", {
        unsubscribedAt: new Date(),
      });
    }

    return c.redirect(`${deps.webBaseUrl}/unsubscribe?status=success`);
  });

  app.post("/unsubscribe", async (c) => {
    let token: string | undefined;

    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await c.req.parseBody();
      const rawToken = formData.token;
      token = typeof rawToken === "string" ? rawToken : c.req.query("token");
    } else {
      try {
        const body: Record<string, unknown> = await c.req.json();
        const rawToken = body.token;
        token = typeof rawToken === "string" ? rawToken : undefined;
      } catch {
        token = undefined;
      }
    }

    if (token) {
      const result = verifySubscriberToken(token, "unsub", deps.sessionSecret);
      if (result.valid) {
        await deps.subscribersRepo.updateStatus(result.subscriberId, "unsubscribed", {
          unsubscribedAt: new Date(),
        });
      }
    }

    return c.json({ ok: true });
  });

  return app;
}
