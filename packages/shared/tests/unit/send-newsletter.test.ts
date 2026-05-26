import { describe, it, expect, vi } from "vitest";
import {
  SEND_NEWSLETTER_QUEUE,
  sendNewsletterJobId,
  enqueueSendNewsletter,
} from "@shared/send-newsletter.js";

describe("SEND_NEWSLETTER_QUEUE", () => {
  it("equals 'send-newsletter'", () => {
    expect(SEND_NEWSLETTER_QUEUE).toBe("send-newsletter");
  });
});

describe("sendNewsletterJobId", () => {
  it("returns 'send-<runId>'", () => {
    expect(sendNewsletterJobId("abc-123")).toBe("send-abc-123");
  });

  it("works with a UUID-style runId", () => {
    const runId = "550e8400-e29b-41d4-a716-446655440000";
    expect(sendNewsletterJobId(runId)).toBe(`send-${runId}`);
  });
});

describe("enqueueSendNewsletter", () => {
  it("calls queue.add with the correct queue name, payload, and jobId option", async () => {
    const mockAdd = vi.fn().mockResolvedValue(undefined);
    const mockQueue = { add: mockAdd } as unknown as Parameters<typeof enqueueSendNewsletter>[0];
    const runId = "run-xyz-789";

    await enqueueSendNewsletter(mockQueue, runId);

    expect(mockAdd).toHaveBeenCalledOnce();
    expect(mockAdd).toHaveBeenCalledWith(
      SEND_NEWSLETTER_QUEUE,
      { runId, subscriberIds: "all" },
      { jobId: `send-${runId}` },
    );
  });

  it("awaits queue.add and resolves when it resolves", async () => {
    const mockAdd = vi.fn().mockResolvedValue(undefined);
    const mockQueue = { add: mockAdd } as unknown as Parameters<typeof enqueueSendNewsletter>[0];

    await expect(enqueueSendNewsletter(mockQueue, "run-1")).resolves.toBeUndefined();
  });
});
