import { describe, expect, it } from "vitest";
import { EmailSendError, RETRYABLE_RESEND_CODES, parseRetryAfter } from "@shared/types/index.js";

describe("RETRYABLE_RESEND_CODES", () => {
  const cases: readonly (readonly [string, boolean])[] = [
    ["rate_limit_exceeded", true],
    ["application_error", true],
    ["internal_server_error", true],
    ["validation_error", false],
    ["missing_required_field", false],
  ];
  it.each(cases)("classifies %s as retryable=%s", (code, retryable) => {
    expect(RETRYABLE_RESEND_CODES.has(code)).toBe(retryable);
  });
});

describe("parseRetryAfter", () => {
  it("converts a delta-seconds string to ms (EDGE-003 positive)", () => {
    expect(parseRetryAfter("2")).toBe(2000);
  });

  it("converts '0' to 0 ms (EDGE-003 zero)", () => {
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("clamps negative delta-seconds to 0 (EDGE-003 negative)", () => {
    expect(parseRetryAfter("-5")).toBe(0);
  });

  it("converts a far-future HTTP-date to positive ms (EDGE-002)", () => {
    const futureDate = new Date(Date.now() + 5000).toUTCString();
    const result = parseRetryAfter(futureDate);
    expect(result).toBeGreaterThan(0);
  });

  it("converts a near-past HTTP-date to 0 ms (EDGE-002 already-past)", () => {
    const pastDate = new Date(Date.now() - 5000).toUTCString();
    const result = parseRetryAfter(pastDate);
    expect(result).toBe(0);
  });

  it("returns null for garbage string (EDGE-002 garbage)", () => {
    expect(parseRetryAfter("not-a-date")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseRetryAfter("")).toBeNull();
  });

  it("returns null for null", () => {
    expect(parseRetryAfter(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseRetryAfter(undefined)).toBeNull();
  });

  it("accepts a now parameter for testability", () => {
    const fixedNow = new Date("2026-01-01T00:00:00.000Z").getTime();
    const retryDate = new Date("2026-01-01T00:00:02.000Z").toUTCString();
    const result = parseRetryAfter(retryDate, fixedNow);
    expect(result).toBe(2000);
  });

  it("converts a large delta-seconds integer to ms", () => {
    expect(parseRetryAfter("60")).toBe(60000);
  });
});

describe("EmailSendError", () => {
  it("exposes code as name and preserves message, retryAfterMs, and retryable", () => {
    const err = new EmailSendError({
      code: "rate_limit_exceeded",
      message: "Resend error: Too many requests",
      retryAfterMs: 2000,
      retryable: true,
    });
    expect(err.name).toBe("rate_limit_exceeded");
    expect(err.message).toBe("Resend error: Too many requests");
    expect(err.retryAfterMs).toBe(2000);
    expect(err.retryable).toBe(true);
  });

  it("allows null retryAfterMs", () => {
    const err = new EmailSendError({
      code: "validation_error",
      message: "Resend error: Invalid email",
      retryAfterMs: null,
      retryable: false,
    });
    expect(err.retryAfterMs).toBeNull();
    expect(err.retryable).toBe(false);
  });

  it("is an instance of Error", () => {
    const err = new EmailSendError({
      code: "application_error",
      message: "Resend error: server error",
      retryAfterMs: null,
      retryable: true,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(EmailSendError);
  });
});
