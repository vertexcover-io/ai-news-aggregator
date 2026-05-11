import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: vi.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  SendEmailCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

import { createSesProvider } from "@api/lib/email/ses-provider.js";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";

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

describe("createSesProvider", () => {
  it("returns messageId from successful send", async () => {
    mockSend.mockResolvedValue({ MessageId: "ses-msg-123" });
    const provider = createSesProvider();
    const result = await provider.send(baseParams);
    expect(result).toEqual({ messageId: "ses-msg-123" });
  });

  it("returns empty string messageId when MessageId is undefined", async () => {
    mockSend.mockResolvedValue({ MessageId: undefined });
    const provider = createSesProvider();
    const result = await provider.send(baseParams);
    expect(result).toEqual({ messageId: "" });
  });

  it("maps custom headers to Name/Value format for SES", async () => {
    mockSend.mockResolvedValue({ MessageId: "m1" });
    const provider = createSesProvider();
    await provider.send({ ...baseParams, headers: { "X-Custom": "value", "X-Other": "val2" } });

    const cmd = vi.mocked(SendEmailCommand).mock.calls[0][0];
    expect(cmd.Content?.Simple?.Headers).toEqual([
      { Name: "X-Custom", Value: "value" },
      { Name: "X-Other", Value: "val2" },
    ]);
  });

  it("omits Headers from SES command when no headers param is provided", async () => {
    mockSend.mockResolvedValue({ MessageId: "m2" });
    const provider = createSesProvider();
    await provider.send(baseParams);

    const cmd = vi.mocked(SendEmailCommand).mock.calls[0][0];
    expect(cmd.Content?.Simple?.Headers).toBeUndefined();
  });

  it("sets ReplyToAddresses when replyTo is provided", async () => {
    mockSend.mockResolvedValue({ MessageId: "m3" });
    const provider = createSesProvider();
    await provider.send({ ...baseParams, replyTo: "reply@example.com" });

    const cmd = vi.mocked(SendEmailCommand).mock.calls[0][0];
    expect(cmd.ReplyToAddresses).toEqual(["reply@example.com"]);
  });

  it("omits ReplyToAddresses when replyTo is not provided", async () => {
    mockSend.mockResolvedValue({ MessageId: "m4" });
    const provider = createSesProvider();
    await provider.send(baseParams);

    const cmd = vi.mocked(SendEmailCommand).mock.calls[0][0];
    expect(cmd.ReplyToAddresses).toBeUndefined();
  });
});
