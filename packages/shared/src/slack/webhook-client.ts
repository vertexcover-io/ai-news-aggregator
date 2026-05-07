export type WebhookPostResult =
  | { ok: true }
  | { ok: false; status: number | "network"; error: string };

export async function postToWebhook(args: {
  url: string;
  blocks: unknown[];
  fetchFn?: typeof fetch;
}): Promise<WebhookPostResult> {
  const fetchFn = args.fetchFn ?? fetch;
  try {
    const response = await fetchFn(args.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blocks: args.blocks }),
    });
    const body = await response.text();
    if (response.status === 200 && body === "ok") {
      return { ok: true };
    }
    return {
      ok: false,
      status: response.status,
      error: body.length > 0 ? body : "non-ok response",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: "network", error: message };
  }
}
