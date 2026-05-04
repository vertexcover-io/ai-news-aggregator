// NOTE: This is the single architectural exception to the rule that
// `rettiwt-api` must not appear in the `@newsletter/api` package. The
// resolver is the only api-package module allowed to import it; it
// performs save-time @handle -> numeric userId resolution before the
// pipeline ever sees the config. Documented in the design doc under
// "Architectural rule exception".
import type { Rettiwt, User } from "rettiwt-api";

export interface TwitterHandleResolverDeps {
  rettiwtFactory: () => Rettiwt;
}

export interface ResolvedHandle {
  handle: string;
  userId: string;
}

export type TwitterHandleResolutionReason =
  | "not_found"
  | "auth_failed"
  | "missing_api_key"
  | "unknown";

export class TwitterHandleResolutionError extends Error {
  public readonly handle: string;
  public readonly reason: TwitterHandleResolutionReason;

  constructor(
    handle: string,
    reason: TwitterHandleResolutionReason,
    cause?: unknown,
  ) {
    super(`failed to resolve @${handle}: ${reason}`);
    this.name = "TwitterHandleResolutionError";
    this.handle = handle;
    this.reason = reason;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export async function resolveTwitterHandles(
  handles: string[],
  deps: TwitterHandleResolverDeps,
): Promise<ResolvedHandle[]> {
  if (handles.length === 0) return [];

  const apiKey = process.env.RETTIWT_API_KEY;
  if (!apiKey) {
    throw new TwitterHandleResolutionError(handles[0], "missing_api_key");
  }

  const rettiwt = deps.rettiwtFactory();
  const out: ResolvedHandle[] = [];

  for (const raw of handles) {
    const handle = raw.replace(/^@/, "").trim();
    if (!handle) continue;

    let user: User | undefined;
    try {
      user = await rettiwt.user.details(handle);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const reason: TwitterHandleResolutionReason = /not authorized/i.test(msg)
        ? "auth_failed"
        : "unknown";
      throw new TwitterHandleResolutionError(handle, reason, err);
    }

    if (!user?.id) {
      throw new TwitterHandleResolutionError(handle, "not_found");
    }

    out.push({ handle: user.userName || handle, userId: user.id });
  }

  return out;
}
