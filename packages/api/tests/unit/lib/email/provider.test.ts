import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock both providers before importing the factory
vi.mock("@api/lib/email/ses-provider.js", () => ({
  createSesProvider: vi.fn(() => ({
    send: vi.fn().mockResolvedValue({ messageId: "ses-msg-id" }),
  })),
}));

vi.mock("@api/lib/email/resend-provider.js", () => ({
  createResendProvider: vi.fn(() => ({
    send: vi.fn().mockResolvedValue({ messageId: "resend-msg-id" }),
  })),
}));

import { createEmailProvider } from "@api/lib/email/provider.js";
import { createSesProvider } from "@api/lib/email/ses-provider.js";
import { createResendProvider } from "@api/lib/email/resend-provider.js";

beforeEach(() => {
  vi.resetModules();
  delete process.env.EMAIL_PROVIDER;
});

describe("createEmailProvider", () => {
  it("returns resend provider when EMAIL_PROVIDER is unset", () => {
    delete process.env.EMAIL_PROVIDER;
    createEmailProvider();
    expect(createResendProvider).toHaveBeenCalled();
  });

  it("returns resend provider when EMAIL_PROVIDER=resend", () => {
    process.env.EMAIL_PROVIDER = "resend";
    createEmailProvider();
    expect(createResendProvider).toHaveBeenCalled();
  });

  it("returns ses provider when EMAIL_PROVIDER=ses", () => {
    process.env.EMAIL_PROVIDER = "ses";
    createEmailProvider();
    expect(createSesProvider).toHaveBeenCalled();
  });

  it("returned provider implements the send method", async () => {
    delete process.env.EMAIL_PROVIDER;
    const provider = createEmailProvider();
    expect(typeof provider.send).toBe("function");
    const result = await provider.send({
      to: ["test@example.com"],
      from: "sender@example.com",
      subject: "Test",
      html: "<p>Test</p>",
      text: "Test",
    });
    expect(result).toHaveProperty("messageId");
  });
});
