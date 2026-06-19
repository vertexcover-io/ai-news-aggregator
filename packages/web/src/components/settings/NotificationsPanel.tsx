/**
 * Notifications panel (P16, REQ-090–092): where we ping the tenant when a
 * run is ready to review or something fails. Email + Slack incoming webhook
 * (stored encrypted, write-only — the saved URL is never echoed back) plus
 * the review-ready / error-alert toggles.
 */
import { useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  getNotificationSettings,
  putNotificationSettings,
} from "../../api/notifications";

const QUERY_KEY = ["notification-settings"] as const;

export function NotificationsPanel(): ReactElement {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getNotificationSettings });

  const [email, setEmail] = useState("");
  const [webhook, setWebhook] = useState("");
  const [reviewReady, setReviewReady] = useState(true);
  const [errors, setErrors] = useState(true);
  const [hydratedAt, setHydratedAt] = useState(0);

  // Render-time hydration (D-004 pattern): adopt the fetched values once per
  // server snapshot. The webhook input never hydrates from the server
  // (write-only secret); a configured webhook shows as a placeholder instead.
  if (query.data && query.dataUpdatedAt !== hydratedAt) {
    setEmail(query.data.notifyEmail ?? "");
    setReviewReady(query.data.notifyReviewReady);
    setErrors(query.data.notifyErrors);
    setHydratedAt(query.dataUpdatedAt);
  }

  const save = useMutation({
    mutationFn: putNotificationSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(QUERY_KEY, saved);
      setWebhook("");
      toast.success("Notification settings saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const webhookConfigured = query.data?.slackWebhookSet === true;

  const handleSave = (): void => {
    const trimmedWebhook = webhook.trim();
    save.mutate({
      notifyEmail: email.trim() === "" ? null : email.trim(),
      // Untouched input + already configured → omit (keep the stored secret).
      ...(trimmedWebhook !== "" || !webhookConfigured
        ? { slackWebhook: trimmedWebhook === "" ? null : trimmedWebhook }
        : {}),
      notifyReviewReady: reviewReady,
      notifyErrors: errors,
    });
  };

  return (
    <Card data-testid="notifications-panel">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Where we ping you when a run is ready to review or something fails.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="notify-email">Notification email</Label>
          <Input
            id="notify-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notify-slack-webhook">Slack incoming webhook</Label>
          <Input
            id="notify-slack-webhook"
            type="password"
            placeholder={
              webhookConfigured
                ? "•••••••• (configured — paste a new URL to replace)"
                : "https://hooks.slack.com/services/…"
            }
            value={webhook}
            onChange={(e) => {
              setWebhook(e.target.value);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Create an Incoming Webhook in your Slack workspace and paste the
            URL. Stored encrypted.
          </p>
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <div>
            <p className="text-sm font-medium">Review-ready alerts</p>
            <p className="text-xs text-muted-foreground">
              Notify me when a daily run finishes and is ready to curate.
            </p>
          </div>
          <Switch
            aria-label="Review-ready alerts"
            checked={reviewReady}
            onCheckedChange={setReviewReady}
          />
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <div>
            <p className="text-sm font-medium">Error alerts</p>
            <p className="text-xs text-muted-foreground">
              Notify me when a collector fails or a run crashes.
            </p>
          </div>
          <Switch
            aria-label="Error alerts"
            checked={errors}
            onCheckedChange={setErrors}
          />
        </div>

        <div className="flex justify-end border-t pt-4">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={save.isPending || query.isLoading}
          >
            {save.isPending ? "Saving…" : "Save notifications"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
