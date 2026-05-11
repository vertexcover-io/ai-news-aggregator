import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEmailsSend = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockEmailsSend },
  })),
}));

import { createResendProvider } from "@api/lib/email/resend-provider.js";

beforeEach(() => {
  vi.clearAllMocks();
});

const baseParams = {
  from: "sender@example.com",
  to: ["recipient@example.com"],
  subject: "Test subject",
  html: "<p>Hello</p>",
  text: "Hello",
};

describe("createResendProvider", () => {
  it("returns messageId from successful send", async () => {
    mockEmailsSend.mockResolvedValue({ data: { id: "resend-msg-id-1" }, error: null });
    const provider = createResendProvider();
    const result = await provider.send(baseParams);
    expect(result).toEqual({ messageId: "resend-msg-id-1" });
  });

  it("forwards all params to the Resend SDK", async () => {
    mockEmailsSend.mockResolvedValue({ data: { id: "x" }, error: null });
    const provider = createResendProvider();
    const params = {
      ...baseParams,
      replyTo: "reply@example.com",
      headers: { "X-Custom": "value" },
    };
    await provider.send(params);
    expect(mockEmailsSend).toHaveBeenCalledWith({
      from: params.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      replyTo: params.replyTo,
      headers: params.headers,
    });
  });

  it("throws with 'Resend error: <message>' when result.error is non-null", async () => {
    mockEmailsSend.mockResolvedValue({
      data: null,
      error: { message: "invalid_api_key" },
    });
    const provider = createResendProvider();
    await expect(provider.send(baseParams)).rejects.toThrow("Resend error: invalid_api_key");
  });
});
