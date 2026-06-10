import { useState, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetchAdmin } from "../../api/client";

interface NotificationsConfig {
  notifyEmail: string | null;
  slackWebhook: Record<string, string> | null;
}

interface Props {
  config: NotificationsConfig;
}

export function NotificationsPanel({ config }: Props): ReactElement {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(config.notifyEmail ?? "");
  const [webhook, setWebhook] = useState("");

  const saveMutation = useMutation({
    mutationFn: async (data: { notifyEmail: string | null; slackWebhook: string | null }) => {
      const res = await apiFetchAdmin("/api/settings/notifications", {
        method: "PUT",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to save notification settings");
      }
      return res.json() as Promise<NotificationsConfig>;
    },
    onSuccess: (saved) => {
      toast.success("Notification settings saved");
      queryClient.setQueryData(["settings", "notifications"], saved);
      setWebhook(""); // Clear the plaintext webhook input after save
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to save";
      toast.error(message);
    },
  });

  const handleSave = () => {
    const notifyEmail = email.trim() || null;
    const slackWebhookVal = webhook.trim() || null;
    saveMutation.mutate({ notifyEmail, slackWebhook: slackWebhookVal });
  };

  return (
    <div className="rounded-lg border bg-white p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure where review-ready and error alerts are sent for this tenant.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="notify-email" className="block text-sm font-medium">
            Notification Email
          </label>
          <input
            id="notify-email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); }}
            placeholder="ops@example.com"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Review-ready notifications will be sent to this address.
          </p>
        </div>

        <div>
          <label htmlFor="slack-webhook" className="block text-sm font-medium">
            Slack Webhook URL
          </label>
          <input
            id="slack-webhook"
            type="url"
            value={webhook}
            onChange={(e) => { setWebhook(e.target.value); }}
            placeholder="https://hooks.slack.com/services/..."
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Slack incoming webhook for review-ready and error alerts. Stored encrypted.
            {config.slackWebhook !== null && (
              <span className="text-green-600"> A webhook is configured.</span>
            )}
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saveMutation.isPending ? "Saving..." : "Save Notifications"}
        </button>
      </div>
    </div>
  );
}
