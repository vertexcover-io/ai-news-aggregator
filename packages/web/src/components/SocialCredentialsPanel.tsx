import { useEffect, useState, type ReactElement } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
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
import { Separator } from "@/components/ui/separator";
import {
  useDeleteSocialCredentials,
  useLinkedInOAuthStatus,
  useSaveTwitterCredentials,
  useSocialCredentialsStatus,
  startLinkedInOAuth,
  SocialCredentialsApiError,
  type LinkedInStatus,
  type TwitterStatus,
} from "../api/socialCredentials";

interface TwitterFormValues {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatExpiresAt(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

interface StatusPillProps {
  configured: boolean;
  updatedAt: string | null;
  extra?: string | null;
}

function StatusPill({
  configured,
  updatedAt,
  extra,
}: StatusPillProps): ReactElement {
  if (!configured) {
    return (
      <span
        data-testid="status-pill"
        data-configured="false"
        className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700"
      >
        Not configured
      </span>
    );
  }
  const detail = [extra, updatedAt ? `updated ${formatUpdatedAt(updatedAt)}` : null]
    .filter((v): v is string => Boolean(v))
    .join(" · ");
  return (
    <span
      data-testid="status-pill"
      data-configured="true"
      className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800"
    >
      Configured{detail ? ` (${detail})` : ""}
    </span>
  );
}

interface LinkedInConnectionSectionProps {
  clientConfigured: boolean;
}

function LinkedInConnectionSection({
  clientConfigured,
}: LinkedInConnectionSectionProps): ReactElement {
  const oauthStatus = useLinkedInOAuthStatus();
  const disconnect = useDeleteSocialCredentials();
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle ?linkedin=connected / ?linkedin=error on mount (REQ-012).
  useEffect(() => {
    const param = searchParams.get("linkedin");
    if (!param) return;

    if (param === "connected") {
      toast.success("LinkedIn connected successfully");
      void oauthStatus.refetch();
    } else if (param === "error") {
      const reason = searchParams.get("reason") ?? "unknown";
      toast.error(`LinkedIn connection failed: ${reason}`);
    }

    // Strip the param from the URL.
    const next = new URLSearchParams(searchParams);
    next.delete("linkedin");
    next.delete("reason");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect(): Promise<void> {
    try {
      const result = await startLinkedInOAuth();
      window.location.assign(result.authorizeUrl);
    } catch {
      toast.error("Failed to start LinkedIn OAuth");
    }
  }

  const data = oauthStatus.data;
  const connected = data?.connected ?? false;
  const isConnectDisabled = !clientConfigured;

  const statusText = (): string => {
    if (!data || !connected) return "Not connected";
    const parts: string[] = [];
    if (data.connectedAs) parts.push(`Connected as ${data.connectedAs}`);
    if (data.expiresAt) parts.push(`expires ${formatExpiresAt(data.expiresAt)}`);
    if (data.hasRefreshToken) {
      parts.push("refresh token ✓");
    } else {
      parts.push("refresh token ✗ (reconnect to enable)");
    }
    return parts.join(" · ");
  };

  return (
    <div data-testid="linkedin-connection" className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium text-muted-foreground">
          OAuth Connection
        </h4>
      </div>
      <p data-testid="linkedin-conn-status" className="text-sm">
        {oauthStatus.isLoading ? "Loading…" : statusText()}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="linkedin-connect-btn"
          disabled={isConnectDisabled}
          onClick={() => {
            void handleConnect();
          }}
        >
          {connected ? "Reconnect LinkedIn" : "Connect LinkedIn"}
        </Button>
        {connected ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="linkedin-disconnect-btn"
            disabled={disconnect.isPending}
            onClick={() => {
              disconnect.mutate("linkedin", {
                onSuccess: () => {
                  toast.success("LinkedIn disconnected");
                  void oauthStatus.refetch();
                },
                onError: (err: unknown) => {
                  const message =
                    err instanceof Error ? err.message : "Failed to disconnect";
                  toast.error(message);
                },
              });
            }}
          >
            {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
          </Button>
        ) : null}
        {isConnectDisabled ? (
          <p className="text-xs text-muted-foreground">
            The shared LinkedIn app is not configured yet — ask a platform
            super admin to set it up
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface LinkedInSectionProps {
  status: LinkedInStatus;
}

/**
 * P12 (REQ-082): the LinkedIn app client (id/secret) is an APP-LEVEL shared
 * secret managed by platform super admins — tenants only connect/disconnect
 * their own account. The configured flag below reflects the shared client.
 */
function LinkedInSection({ status }: LinkedInSectionProps): ReactElement {
  return (
    <section data-testid="linkedin-section" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">LinkedIn</h3>
        <StatusPill
          configured={status.configured}
          updatedAt={status.updatedAt}
          extra={status.apiVersion ? `apiVersion ${status.apiVersion}` : null}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Auto-posting uses the platform&apos;s shared LinkedIn app. Connect your
        LinkedIn account to publish issues to your own profile.
      </p>
      <LinkedInConnectionSection clientConfigured={status.configured} />
    </section>
  );
}

interface TwitterSectionProps {
  status: TwitterStatus;
}

function TwitterSection({ status }: TwitterSectionProps): ReactElement {
  const form = useForm<TwitterFormValues>({
    defaultValues: {
      apiKey: "",
      apiSecret: "",
      accessToken: "",
      accessTokenSecret: "",
    },
  });
  const save = useSaveTwitterCredentials();
  const remove = useDeleteSocialCredentials();
  const [confirming, setConfirming] = useState(false);

  const onSubmit = form.handleSubmit((values) => {
    const trimmed: TwitterFormValues = {
      apiKey: values.apiKey.trim(),
      apiSecret: values.apiSecret.trim(),
      accessToken: values.accessToken.trim(),
      accessTokenSecret: values.accessTokenSecret.trim(),
    };
    if (
      !trimmed.apiKey ||
      !trimmed.apiSecret ||
      !trimmed.accessToken ||
      !trimmed.accessTokenSecret
    ) {
      toast.error("All four Twitter/X OAuth fields are required");
      return;
    }
    save.mutate(trimmed, {
      onSuccess: () => {
        toast.success("Twitter credentials saved");
        form.reset({
          apiKey: "",
          apiSecret: "",
          accessToken: "",
          accessTokenSecret: "",
        });
      },
      onError: (err: unknown) => {
        const message =
          err instanceof SocialCredentialsApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to save Twitter credentials";
        toast.error(message);
      },
    });
  });

  function handleClear(): void {
    remove.mutate("twitter", {
      onSuccess: () => {
        toast.success("Twitter credentials cleared");
        setConfirming(false);
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to clear";
        toast.error(message);
        setConfirming(false);
      },
    });
  }

  return (
    <section data-testid="twitter-section" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Twitter / X</h3>
        <StatusPill
          configured={status.configured}
          updatedAt={status.updatedAt}
        />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(e);
        }}
        className="space-y-3"
      >
        <div className="grid gap-1.5 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="twitter-apiKey">API Key</Label>
            <Input
              id="twitter-apiKey"
              type="password"
              autoComplete="off"
              placeholder="Consumer key"
              {...form.register("apiKey")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="twitter-apiSecret">API Secret</Label>
            <Input
              id="twitter-apiSecret"
              type="password"
              autoComplete="off"
              placeholder="Consumer secret"
              {...form.register("apiSecret")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="twitter-accessToken">Access Token</Label>
            <Input
              id="twitter-accessToken"
              type="password"
              autoComplete="off"
              {...form.register("accessToken")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="twitter-accessTokenSecret">
              Access Token Secret
            </Label>
            <Input
              id="twitter-accessTokenSecret"
              type="password"
              autoComplete="off"
              {...form.register("accessTokenSecret")}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            data-testid="twitter-save"
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save Twitter"}
          </Button>
          {status.configured && !confirming ? (
            <Button
              type="button"
              variant="outline"
              data-testid="twitter-clear"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Clear Credentials
            </Button>
          ) : null}
          {status.configured && confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Are you sure?
              </span>
              <Button
                type="button"
                variant="destructive"
                data-testid="twitter-clear-confirm"
                disabled={remove.isPending}
                onClick={handleClear}
              >
                {remove.isPending ? "Clearing…" : "Yes, clear"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : null}
        </div>
      </form>
    </section>
  );
}

export function SocialCredentialsPanel(): ReactElement {
  const statusQuery = useSocialCredentialsStatus();

  return (
    <Card data-testid="social-credentials-panel">
      <CardHeader>
        <CardTitle>Social posting credentials</CardTitle>
        <CardDescription>
          Connect LinkedIn and configure Twitter/X auto-posting. Secrets are
          encrypted at rest. Existing values are never displayed — saving
          replaces all fields for that platform.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {statusQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : statusQuery.isError ? (
          <p className="text-sm text-destructive">
            Failed to load credential status.
          </p>
        ) : statusQuery.data ? (
          <>
            <LinkedInSection status={statusQuery.data.linkedin} />
            <Separator />
            <TwitterSection status={statusQuery.data.twitter} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
