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

// Sends an email expecting it to throw, and returns the narrowed EmailSendError.
async function sendExpectingError(): Promise<EmailSendError> {
  const provider = createEmailProvider();
  try {
    await provider.send({ to: ["t@e.com"], from: "f@e.com", subject: "S", html: "<p>h</p>", text: "t" });
  } catch (err) {
    if (err instanceof EmailSendError) return err;
    throw new Error(`expected EmailSendError, got ${String(err)}`, { cause: err });
  }
  throw new Error("expected provider.send to throw");
}

// VS-0.2 + EDGE-006: each Resend error name maps to a fixed retryable verdict.
describe("createResendProvider — retryable vs non-retryable codes", () => {
  it.each<{ name: string; retryable: boolean }>([
    { name: "rate_limit_exceeded", retryable: true },
    { name: "application_error", retryable: true },
    { name: "internal_server_error", retryable: true },
    { name: "validation_error", retryable: false },
    { name: "some_unknown_code", retryable: false },
  ])("marks $name as retryable=$retryable", async ({ name, retryable }) => {
    setupResendMock({
      data: null,
      error: { name, message: `${name} occurred`, statusCode: 500 },
      headers: null,
    });

    const err = await sendExpectingError();
    expect(err.retryable).toBe(retryable);
  });
});

// EDGE-002/EDGE-003: retry-after header parses to ms (clamped non-negative), or
// null when absent/garbage. A future HTTP-date asserts >0 (exact ms drifts);
// every other case asserts an exact ms value.
describe("createResendProvider — retry-after parsing", () => {
  const FUTURE_HTTP_DATE = new Date(Date.now() + 5000).toUTCString();

  it.each<{ label: string; retryAfter: string | undefined; expected: number | null | "positive" }>([
    { label: "future HTTP-date → positive ms", retryAfter: FUTURE_HTTP_DATE, expected: "positive" },
    { label: "garbage string → null", retryAfter: "not-a-date-or-number", expected: null },
    { label: "'0' clamps to 0", retryAfter: "0", expected: 0 },
    { label: "'-5' clamps to 0", retryAfter: "-5", expected: 0 },
    { label: "absent header → null", retryAfter: undefined, expected: null },
  ])("$label", async ({ retryAfter, expected }) => {
    setupResendMock({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Rate limited", statusCode: 429 },
      headers: retryAfter === undefined ? null : { "retry-after": retryAfter },
    });

    const err = await sendExpectingError();
    if (expected === "positive") {
      expect(err.retryAfterMs).toBeGreaterThan(0);
    } else {
      expect(err.retryAfterMs).toBe(expected);
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

  // ADD: Resend returns neither data nor error (the module-level default mock's
  // shape). The provider only branches on a non-null error, then reads
  // `result.data.id` — so this edge throws while dereferencing null data rather
  // than returning a usable messageId. Asserting the rejection documents the
  // gap and guards against a regression that silently emits an empty messageId.
  it("rejects (does not return a messageId) when Resend returns data:null and error:null", async () => {
    setupResendMock({ data: null, error: null, headers: null });

    const provider = createEmailProvider();
    await expect(
      provider.send({ to: ["t@e.com"], from: "f@e.com", subject: "S", html: "<p>h</p>", text: "t" }),
    ).rejects.toThrow();
  });
});
