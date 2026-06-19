import type { FieldErrors } from "react-hook-form";

/**
 * Depth-first search for the first field-level error `message` in a
 * react-hook-form errors tree. RHF nests errors to mirror the form shape
 * (e.g. `twitterConfig.listIds[0].value.message`); reading only a top-level
 * field's `.message` misses those and forces a generic "check your inputs."
 * toast. This walks objects/arrays and returns the first string `message`.
 */
export function firstFieldErrorMessage(
  errors: FieldErrors | undefined,
): string | undefined {
  if (errors === undefined) return undefined;
  return walk(errors as unknown);
}

function walk(node: unknown): string | undefined {
  if (node === null || typeof node !== "object") return undefined;

  // A leaf field error: { message: string, type?, ref? }.
  const message = (node as { message?: unknown }).message;
  if (typeof message === "string" && message.length > 0) return message;

  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = walk(value);
    if (found !== undefined) return found;
  }
  return undefined;
}
