import type { AlertChannel, Incident } from "../types/incident.js";
import { postToWebhook } from "./webhook-client.js";
import { buildIncidentMessage } from "./builders/incident.js";

export interface SlackAlertChannelDeps {
  webhookUrl: string | undefined;
  /** Injectable fetch function for testing. */
  fetchFn?: typeof fetch;
  /** Optional base URL for run links in messages. */
  publicBaseUrl?: string;
}

/**
 * Create a Slack AlertChannel backed by postToWebhook.
 *
 * When `webhookUrl` is undefined/empty the channel is disabled (REQ-019):
 * `enabled` is false and `send` is never called.
 */
export function createSlackAlertChannel(deps: SlackAlertChannelDeps): AlertChannel {
  const { fetchFn, publicBaseUrl } = deps;
  // Capture the url as a narrowed string only when non-empty (REQ-019)
  const url: string | undefined =
    deps.webhookUrl !== undefined && deps.webhookUrl.length > 0
      ? deps.webhookUrl
      : undefined;
  const isEnabled = url !== undefined;

  return {
    get enabled(): boolean {
      return isEnabled;
    },

    async send(incident: Incident): Promise<boolean> {
      if (url === undefined) return false;
      const { blocks } = buildIncidentMessage(incident, publicBaseUrl);
      const result = await postToWebhook({ url, blocks, fetchFn });
      return result.ok;
    },
  };
}
