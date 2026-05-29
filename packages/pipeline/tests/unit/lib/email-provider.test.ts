import { describe, expect, it, vi, beforeEach } from "vitest";
import { EmailSendError } from "@newsletter/shared/types";

// Fake Resend client factory
function makeFakeResendClient(response: {
  data: null | { id: string };
  error: null | { name: string; message: string; statusCode: number };
  headers: Record<string, string> | null;
}) {
  return {
    emails: {
      send: vi.fn(() => Promise.resolve(response)),
    },
  };
}

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => makeFakeResendClient({
    data: null,
    error: null,
    headers: null,
  })),
}));

// Import AFTER mock setup
const { createEmailProvider } = await import("@pipeline/lib/email-provider.js");
const { Resend } = await import("resend");

beforeEach(() => {
  vi.clearAllMocks();
});

function setupResendMock(response: {
  data: null | { id: string };
  error: null | { name: string; message: string; statusCode: number };
  headers: Record<string, string> | null;
}): void {
  vi.mocked(Resend).mockImplementation(() => makeFakeResendClient(response) as never);
}

describe("createResendProvider — VS-0.1: rate_limit_exceeded error shape", () => {
  it("throws EmailSendError with name=rate_limit_exceeded, retryAfterMs=2000, retryable=true", async () => {
    setupResendMock({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Too many requests", statusCode: 429 },
      headers: { "retry-after": "2" },
    });

    const provider = createEmailProvider();
    const sendPromise = provider.send({
      to: ["test@example.com"],
      from: "from@example.com",
      subject: "Test",
      html: "<p>test</p>",
      text: "test",
    });

    await expect(sendPromise).rejects.toBeInstanceOf(EmailSendError);

    try {
      await provider.send({
        to: ["test@example.com"],
        from: "from@example.com",
        subject: "Test",
        html: "<p>test</p>",
        text: "test",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(EmailSendError);
      const emailErr = err as EmailSendError;
      expect(emailErr.name).toBe("rate_limit_exceeded");
      expect(emailErr.retryAfterMs).toBe(2000);
      expect(emailErr.retryable).toBe(true);
      expect(emailErr.message).toContain("Too many requests");
      expect(emailErr.message).toBe("Resend error: Too many requests");
    }
  });
});

describe("createResendProvider — VS-0.2: retryable vs non-retryable codes", () => {
  it("marks application_error as retryable", async () => {
    setupResendMock({
      data: null,
      error: { name: "application_error", message: "App error", statusCode: 500 },
      headers: null,
    });
    const provider = createEmailProvider();
    try {
      await provider.send({ to: ["t@e.com"], from: "f@e.com", subject: "S", html: "<p>h</p>", text: "t" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailSendError);
      expect((err as EmailSendError).retryable).toBe(true);
    }
  });

  it("marks internal_server_error as retryable", async () => {
    setupResendMock({
      data: null,
      error: { name: "internal_server_error", message: "ISE", statusCode: 500 },
      headers: null,
    });
    const provider = createEmailProvider();
    try {
      await provider.send({ to: ["t@e.com"], from: "f@e.com", subject: "S", html: "<p>h</p>", text: "t" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailSendError);
      expect((err as EmailSendError).retryable).toBe(true);
    }
  });

  it("marks validation_error as non-retryable", async () => {
    setupResendMock({
      data: null,
      error: { name: "validation_error", message: "Invalid email", statusCode: 422 },
      headers: null,
    });
    const provider = createEmailProvider();
    try {
      await provider.send({ to: ["t@e.com"], from: "f@e.com", subject: "S", html: "<p>h</p>", text: "t" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailSendError);
      expect((err as EmailSendError).retryable).toBe(false);
    }
  });
});

describe("createResendProvider — EDGE-002: retry-after as HTTP-date", () => {
  it("parses a future HTTP-date to positive ms", async () => {
    const futureDate = new Date(Date.now() + 5000).toUTCString();
    setupResendMock({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Rate limited", statusCode: 429 },
      headers: { "retry-after": futureDate },
    });
    const provider = createEmailProvider();
    try {
      await provider.send({ to: ["t@e.com"], from: "f@e.com", subject: "S", html: "<p>h</p>", text: "t" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailSendError);
      expect((err as EmailSendError).retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("returns null retryAfterMs for a garbage retry-after string (EDGE-002 garbage)", async () => {
    setupResendMock({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Rate limited", statusCode: 429 },
      headers: { "retry-after": "not-a-date-or-number" },
    });
    const provider = createEmailProvider();
    try {
      await provider.send({ to: ["t@e.com"], from: "f@e.com", subject: "S", html: "<p>h</p>", text: "t" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailSendError);
      expect((err as EmailSendError).retryAfterMs).toBeNull();
    }
  });
});

describe("createResendProvider — EDGE-003: retry-after zero and negative", () => {
  it("clamps retry-after '0' to retryAfterMs=0", async () => {
    setupResendMock({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Rate limited", statusCode: 429 },
      headers: { "retry-after": "0" },
    });
    const provider = createEmailProvider();
    try {
      await provider.send({ to: ["t@e.com"], from: "f@e.com", subject: "S", html: "<p>h</p>", text: "t" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailSendError);
      expect((err as EmailSendError).retryAfterMs).toBe(0);
    }
  });

  it("clamps retry-after '-5' to retryAfterMs=0", async () => {
    setupResendMock({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Rate limited", statusCode: 429 },
      headers: { "retry-after": "-5" },
    });
    const provider = createEmailProvider();
    try {
      await provider.send({ to: ["t@e.com"], from: "f@e.com", subject: "S", html: "<p>h</p>", text: "t" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailSendError);
      expect((err as EmailSendError).retryAfterMs).toBe(0);
    }
  });
});

describe("createResendProvider — EDGE-006: no Resend error name (null headers)", () => {
  it("throws EmailSendError with retryable=false when name is unknown", async () => {
    setupResendMock({
      data: null,
      error: { name: "some_unknown_code", message: "Unknown error", statusCode: 500 },
      headers: null,
    });
    const provider = createEmailProvider();
    try {
      await provider.send({ to: ["t@e.com"], from: "f@e.com", subject: "S", html: "<p>h</p>", text: "t" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailSendError);
      expect((err as EmailSendError).retryable).toBe(false);
      expect((err as EmailSendError).retryAfterMs).toBeNull();
    }
  });
});

describe("createResendProvider — successful send", () => {
  it("returns messageId on success", async () => {
    setupResendMock({
      data: { id: "msg-abc-123" },
      error: null,
      headers: {},
    });
    const provider = createEmailProvider();
    const result = await provider.send({
      to: ["t@e.com"],
      from: "f@e.com",
      subject: "S",
      html: "<p>h</p>",
      text: "t",
    });
    expect(result.messageId).toBe("msg-abc-123");
  });
});
