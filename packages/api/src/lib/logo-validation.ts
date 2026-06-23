/**
 * Tenant logo upload validation (P7, REQ-029/039, EDGE-007).
 *
 * Pure byte-sniffing validator shared by every logo intake path (P11
 * onboarding wizard + settings rebranding): accepts PNG / JPEG / SVG / WebP
 * up to 512 KB, derives the canonical content type from the bytes themselves
 * (never trusting a client-declared MIME), and rejects everything else. The
 * util has no side effects — callers persist only on `ok: true`, so a
 * rejected upload always leaves the previously stored logo unchanged.
 */

export const MAX_LOGO_BYTES = 512 * 1024;

export type LogoContentType =
  | "image/png"
  | "image/jpeg"
  | "image/svg+xml"
  | "image/webp";

export type LogoValidationResult =
  | { ok: true; contentType: LogoContentType }
  | { ok: false; reason: "too_large" | "unsupported_type" };

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function startsWith(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

function startsWithAscii(bytes: Uint8Array, ascii: string, offset = 0): boolean {
  if (bytes.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i += 1) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

function sniffContentType(bytes: Uint8Array): LogoContentType | null {
  if (startsWith(bytes, PNG_MAGIC)) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // WebP: RIFF container — "RIFF" <4-byte size> "WEBP".
  if (startsWithAscii(bytes, "RIFF") && startsWithAscii(bytes, "WEBP", 8)) {
    return "image/webp";
  }
  return sniffSvg(bytes);
}

/** SVG is text — look for an `<svg` root within the (BOM-tolerant) prefix. */
function sniffSvg(bytes: Uint8Array): LogoContentType | null {
  const prefix = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 1024))
    .trimStart();
  if (!(prefix.startsWith("<svg") || prefix.startsWith("<?xml"))) return null;
  return /<svg[\s>]/i.test(prefix) ? "image/svg+xml" : null;
}

export function validateLogo(bytes: Uint8Array): LogoValidationResult {
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, reason: "too_large" };
  const contentType = sniffContentType(bytes);
  if (contentType === null) return { ok: false, reason: "unsupported_type" };
  return { ok: true, contentType };
}
