import { describe, expect, it } from "vitest";
import {
  MAX_LOGO_BYTES,
  validateLogo,
} from "@api/lib/logo-validation.js";

const LOGO_BYTE_CAP: number = MAX_LOGO_BYTES;

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(extra = 16): Uint8Array {
  return new Uint8Array([...PNG_HEADER, ...new Array<number>(extra).fill(0)]);
}

function jpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
}

function webp(): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return bytes;
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("validateLogo", () => {
  it("accepts PNG by magic bytes with image/png", () => {
    expect(validateLogo(png())).toEqual({ ok: true, contentType: "image/png" });
  });

  it("accepts JPEG by magic bytes with image/jpeg", () => {
    expect(validateLogo(jpeg())).toEqual({ ok: true, contentType: "image/jpeg" });
  });

  it("accepts WebP (RIFF....WEBP) with image/webp", () => {
    expect(validateLogo(webp())).toEqual({ ok: true, contentType: "image/webp" });
  });

  it("accepts a plain SVG with image/svg+xml", () => {
    const svg = utf8('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>');
    expect(validateLogo(svg)).toEqual({ ok: true, contentType: "image/svg+xml" });
  });

  it("accepts an SVG with XML declaration, comments, and doctype", () => {
    const svg = utf8(
      '<?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg>\n<svg viewBox="0 0 1 1"></svg>',
    );
    expect(validateLogo(svg)).toEqual({ ok: true, contentType: "image/svg+xml" });
  });

  it("rejects an SVG containing a script element as unsafe", () => {
    const svg = utf8('<svg><script>alert(1)</script></svg>');
    expect(validateLogo(svg)).toEqual({ ok: false, reason: "unsafe_svg" });
  });

  it("rejects an SVG with inline event handlers as unsafe", () => {
    const svg = utf8('<svg onload="alert(1)"><rect/></svg>');
    expect(validateLogo(svg)).toEqual({ ok: false, reason: "unsafe_svg" });
  });

  it("rejects empty input", () => {
    expect(validateLogo(new Uint8Array(0))).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts a payload exactly at the size cap", () => {
    const bytes = new Uint8Array(MAX_LOGO_BYTES);
    bytes.set(PNG_HEADER, 0);
    expect(validateLogo(bytes)).toEqual({ ok: true, contentType: "image/png" });
  });

  it("rejects a payload over the 512KB cap as too_large", () => {
    const bytes = new Uint8Array(LOGO_BYTE_CAP + 1);
    bytes.set(PNG_HEADER, 0);
    expect(validateLogo(bytes)).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects a GIF (disallowed type) regardless of declared type", () => {
    const gif = utf8("GIF89a\x00\x00");
    expect(validateLogo(gif)).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("rejects HTML masquerading as an image", () => {
    const html = utf8("<!DOCTYPE html><html><body>hi</body></html>");
    expect(validateLogo(html)).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("rejects binary garbage", () => {
    expect(validateLogo(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });
});
