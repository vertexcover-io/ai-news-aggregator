/**
 * REQ-039 / EDGE-007 (P7): logo upload validation — accept PNG/JPEG/SVG/WebP
 * up to 512 KB; reject anything else WITHOUT side effects so the caller's
 * existing logo stays untouched (the util is pure — it never mutates input).
 */
import { describe, expect, it } from "vitest";
import {
  MAX_LOGO_BYTES,
  validateLogo,
} from "@api/lib/logo-validation.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP_MAGIC = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 "),
]);
const SVG_BYTES = Buffer.from(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>`);

describe("test_REQ_039_logo_rejects_oversize_and_bad_type", () => {
  it.each([
    ["png", PNG_MAGIC, "image/png"],
    ["jpeg", JPEG_MAGIC, "image/jpeg"],
    ["webp", WEBP_MAGIC, "image/webp"],
    ["svg", SVG_BYTES, "image/svg+xml"],
  ])("accepts a small %s logo and reports its content type", (_label, bytes, contentType) => {
    const result = validateLogo(bytes);
    expect(result).toEqual({ ok: true, contentType });
  });

  it("rejects a logo over 512 KB even when the format is supported", () => {
    const oversize = Buffer.concat([
      PNG_MAGIC,
      Buffer.alloc(MAX_LOGO_BYTES), // magic + filler pushes it past the cap
    ]);
    const result = validateLogo(oversize);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("accepts a logo exactly at the 512 KB boundary", () => {
    const atLimit = Buffer.concat([
      PNG_MAGIC,
      Buffer.alloc(MAX_LOGO_BYTES - PNG_MAGIC.length),
    ]);
    expect(validateLogo(atLimit)).toEqual({ ok: true, contentType: "image/png" });
  });

  it.each([
    ["gif", Buffer.from("GIF89a......")],
    ["bmp", Buffer.from([0x42, 0x4d, 0, 0, 0, 0])],
    ["plain text", Buffer.from("hello, not an image")],
    ["empty", Buffer.alloc(0)],
    ["html (not svg)", Buffer.from("<html><body>x</body></html>")],
  ])("rejects unsupported bytes: %s", (_label, bytes) => {
    expect(validateLogo(bytes)).toEqual({ ok: false, reason: "unsupported_type" });
  });
});

describe("test_EDGE_007_bad_logo_keeps_existing", () => {
  it("is pure: a rejected upload leaves the candidate bytes untouched (caller keeps the prior logo)", () => {
    const bad = Buffer.from("GIF89a......");
    const before = Buffer.from(bad);
    const result = validateLogo(bad);
    expect(result.ok).toBe(false);
    // The util never mutates its input — the caller's persistence layer only
    // runs on ok:true, so the existing stored logo is left as-is.
    expect(bad.equals(before)).toBe(true);
  });
});
