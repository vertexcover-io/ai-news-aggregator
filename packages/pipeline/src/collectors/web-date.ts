import * as chrono from "chrono-node";

/**
 * Resolves a raw date string (relative, natural-language, or ISO) to an
 * absolute Date, using chrono-node for relative/natural-language inputs and
 * falling back to Date.parse for ISO strings. Returns null when neither
 * strategy yields a valid date.
 *
 * Pass an explicit referenceDate so relative resolution ("4 hours ago") is
 * deterministic and tied to collection time — never uses hidden Date.now().
 */
export function resolvePublishedDate(
  raw: string | null | undefined,
  referenceDate: Date,
): Date | null {
  if (!raw) return null;

  const chronoResult = chrono.parseDate(raw, referenceDate);
  if (chronoResult !== null) return chronoResult;

  const ts = Date.parse(raw);
  if (!isNaN(ts)) return new Date(ts);

  return null;
}
