/** Accepted MIME types for logo uploads. */
export const ACCEPTED_LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
] as const;

/** Maximum logo file size in bytes (512 KB). */
export const MAX_LOGO_SIZE_BYTES = 512 * 1024;

export interface LogoUploadInput {
  buffer: Uint8Array;
  contentType: string;
}

export type LogoValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validates a logo upload against MIME type and size limits.
 *
 * Accepts PNG, JPEG, SVG, WebP. Maximum 512 KB. Rejects empty buffers.
 */
export function validateLogoUpload(input: LogoUploadInput): LogoValidationResult {
  if (input.buffer.length === 0) {
    return { ok: false, error: "Logo file is empty" };
  }

  if (input.buffer.length > MAX_LOGO_SIZE_BYTES) {
    return {
      ok: false,
      error: `Logo file exceeds maximum size of ${String(MAX_LOGO_SIZE_BYTES / 1024)}KB`,
    };
  }

  if (
    !input.contentType ||
    !(ACCEPTED_LOGO_TYPES as readonly string[]).includes(input.contentType)
  ) {
    return {
      ok: false,
      error: `Unsupported image type: ${input.contentType || "none"}. Accepted: PNG, JPEG, SVG, WebP.`,
    };
  }

  return { ok: true };
}
