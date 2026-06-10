import { useEffect, type ReactElement } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  patchTenantSettings,
  type TenantSettings,
  type TenantSettingsPatch,
} from "@/api/tenant-settings";

interface NotificationsPanelProps {
  settings: TenantSettings;
}

interface NotificationsForm {
  notificationEmail: string;
  slackWebhook: string;
}

export function NotificationsPanel({
  settings,
}: NotificationsPanelProps): ReactElement {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { dirtyFields },
  } = useForm<NotificationsForm>({
    defaultValues: {
      notificationEmail: settings.notificationEmail ?? "",
      slackWebhook: "",
    },
  });

  useEffect(() => {
    reset({
      notificationEmail: settings.notificationEmail ?? "",
      slackWebhook: "",
    });
  }, [settings, reset]);

  const saveMutation = useMutation({
    mutationFn: (patch: TenantSettingsPatch) => patchTenantSettings(patch),
    onSuccess: (saved) => {
      toast.success("Notifications saved");
      queryClient.setQueryData(["tenant-settings"], saved);
      reset({
        notificationEmail: saved.notificationEmail ?? "",
        slackWebhook: "",
      });
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to save notifications",
      );
    },
  });

  const onSubmit = handleSubmit((values) => {
    const patch: TenantSettingsPatch = {
      notificationEmail: values.notificationEmail.trim() || null,
    };
    // Only send the Slack webhook when the operator actually typed something —
    // the GET never returns the raw secret, so an untouched field is empty and
    // must not overwrite the stored webhook.
    if (dirtyFields.slackWebhook) {
      patch.slackWebhook = values.slackWebhook.trim() || null;
    }
    saveMutation.mutate(patch);
  });

  return (
    <Card id="notify">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Where we ping you when a run is ready to review or something fails.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            void onSubmit(e);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="notification-email">Notification email</Label>
            <Input
              id="notification-email"
              type="email"
              placeholder="you@studio.com"
              {...register("notificationEmail")}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="slack-webhook">Slack incoming webhook</Label>
            <Input
              id="slack-webhook"
              type="password"
              autoComplete="off"
              placeholder={
                settings.slackWebhookConfigured
                  ? "•••••••• (configured — leave blank to keep)"
                  : "https://hooks.slack.com/services/…"
              }
              {...register("slackWebhook")}
            />
            <p className="text-sm text-muted-foreground">
              Create an Incoming Webhook in your Slack workspace and paste the
              URL. Stored encrypted.
            </p>
          </div>

          <div className="flex items-center justify-end border-t pt-4">
            <Button
              type="submit"
              disabled={saveMutation.isPending}
              className="min-h-[44px]"
            >
              {saveMutation.isPending ? "Saving..." : "Save notifications"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
