import { apiFetch } from "./client.js";

export async function postSubscribe(
  email: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await apiFetch("/api/subscribe", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (!res.ok) return { error: "request_failed" };
    return { ok: true };
  } catch {
    return { error: "network_error" };
  }
}
