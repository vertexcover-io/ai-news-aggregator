export const MAX_LOGO_BYTES = 512 * 1024;

export type LogoRejectionReason =
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "unsafe_svg";

export type LogoValidation =
  | { ok: true; contentType: string }
  | { ok: false; reason: LogoRejectionReason };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

const SVG_ROOT_RE =
  /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i;
const UNSAFE_SVG_RE =
  /<script[\s>]|\bjavascript:|\son\w+\s*=|<foreignObject[\s>]|attributeName\s*=\s*["']?on/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  tab: "\t",
  newline: "\n",
  colon: ":",
  sol: "/",
};

/** Resolves numeric (&#106; / &#x6A;) and common named character references so
 * entity-encoded payloads ("&#106;avascript:") can't slip past the scan. */
function decodeCharacterReferences(text: string): string {
  return text.replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi,
    (match, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
      if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
      if (dec !== undefined) return String.fromCodePoint(parseInt(dec, 10));
      if (named !== undefined) return NAMED_ENTITIES[named.toLowerCase()] ?? match;
      return match;
    },
  );
}

function matchesAt(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

function classifySvg(bytes: Uint8Array): LogoValidation {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "unsupported_type" };
  }
  if (!SVG_ROOT_RE.test(text)) return { ok: false, reason: "unsupported_type" };
  // Scan raw AND entity-decoded text: denylists are bypassable via character
  // references, and the served bytes are the raw text the browser will decode.
  if (UNSAFE_SVG_RE.test(text)) return { ok: false, reason: "unsafe_svg" };
  if (UNSAFE_SVG_RE.test(decodeCharacterReferences(text))) {
    return { ok: false, reason: "unsafe_svg" };
  }
  return { ok: true, contentType: "image/svg+xml" };
}

/**
 * Pure logo upload gate (REQ-039/EDGE-007): allowlists PNG/JPEG/WebP by magic
 * bytes and SVG by sniffed root element (with a script/handler sanity check),
 * capped at MAX_LOGO_BYTES. Declared content types are ignored entirely.
 */
export function validateLogo(bytes: Uint8Array): LogoValidation {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, reason: "too_large" };
  if (matchesAt(bytes, PNG_SIGNATURE)) return { ok: true, contentType: "image/png" };
  if (matchesAt(bytes, JPEG_SIGNATURE)) return { ok: true, contentType: "image/jpeg" };
  if (matchesAt(bytes, RIFF) && matchesAt(bytes, WEBP, 8)) {
    return { ok: true, contentType: "image/webp" };
  }
  return classifySvg(bytes);
}
