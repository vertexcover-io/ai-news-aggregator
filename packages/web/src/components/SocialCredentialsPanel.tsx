import { useState, type ReactElement } from "react";
import { useForm } from "react-hook-form";
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
  useSaveLinkedInCredentials,
  useSaveTwitterCollectorCookie,
  useSaveTwitterCredentials,
  useSocialCredentialsStatus,
  SocialCredentialsApiError,
  type LinkedInStatus,
  type TwitterCollectorStatus,
  type TwitterStatus,
} from "../api/socialCredentials";

interface LinkedInFormValues {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
}

interface TwitterFormValues {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

interface TwitterCollectorFormValues {
  apiKey: string;
}

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
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

interface LinkedInSectionProps {
  status: LinkedInStatus;
}

function LinkedInSection({ status }: LinkedInSectionProps): ReactElement {
  const form = useForm<LinkedInFormValues>({
    defaultValues: { clientId: "", clientSecret: "", apiVersion: "202511" },
  });
  const save = useSaveLinkedInCredentials();
  const remove = useDeleteSocialCredentials();
  const [confirming, setConfirming] = useState(false);

  const onSubmit = form.handleSubmit((values) => {
    const trimmedId = values.clientId.trim();
    const trimmedSecret = values.clientSecret.trim();
    const trimmedVersion = values.apiVersion.trim();
    if (!trimmedId || !trimmedSecret) {
      toast.error("LinkedIn clientId and clientSecret are required");
      return;
    }
    save.mutate(
      {
        clientId: trimmedId,
        clientSecret: trimmedSecret,
        apiVersion: trimmedVersion || undefined,
      },
      {
        onSuccess: () => {
          toast.success("LinkedIn credentials saved");
          form.reset({
            clientId: "",
            clientSecret: "",
            apiVersion: trimmedVersion || "202511",
          });
        },
        onError: (err: unknown) => {
          const message =
            err instanceof SocialCredentialsApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Failed to save LinkedIn credentials";
          toast.error(message);
        },
      },
    );
  });

  function handleClear(): void {
    remove.mutate("linkedin", {
      onSuccess: () => {
        toast.success("LinkedIn credentials cleared");
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
    <section data-testid="linkedin-section" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">LinkedIn</h3>
        <StatusPill
          configured={status.configured}
          updatedAt={status.updatedAt}
          extra={status.apiVersion ? `apiVersion ${status.apiVersion}` : null}
        />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(e);
        }}
        className="space-y-3"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="linkedin-clientId">Client ID</Label>
          <Input
            id="linkedin-clientId"
            type="password"
            autoComplete="off"
            placeholder="Not stored locally — enter to update"
            {...form.register("clientId")}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="linkedin-clientSecret">Client Secret</Label>
          <Input
            id="linkedin-clientSecret"
            type="password"
            autoComplete="off"
            placeholder="Not stored locally — enter to update"
            {...form.register("clientSecret")}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="linkedin-apiVersion">API version</Label>
          <Input
            id="linkedin-apiVersion"
            type="text"
            autoComplete="off"
            placeholder="202511"
            {...form.register("apiVersion")}
          />
          <p className="text-xs text-muted-foreground">
            Optional. Defaults to <code>202511</code>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            data-testid="linkedin-save"
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save LinkedIn"}
          </Button>
          {status.configured && !confirming ? (
            <Button
              type="button"
              variant="outline"
              data-testid="linkedin-clear"
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
                data-testid="linkedin-clear-confirm"
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

interface TwitterCollectorSectionProps {
  status: TwitterCollectorStatus;
}

function TwitterCollectorSection({
  status,
}: TwitterCollectorSectionProps): ReactElement {
  const form = useForm<TwitterCollectorFormValues>({
    defaultValues: { apiKey: "" },
  });
  const save = useSaveTwitterCollectorCookie();
  const remove = useDeleteSocialCredentials();
  const [confirming, setConfirming] = useState(false);

  const onSubmit = form.handleSubmit((values) => {
    const trimmed = values.apiKey.trim();
    if (!trimmed) {
      toast.error("Base64 cookie blob is required");
      return;
    }
    save.mutate(
      { apiKey: trimmed },
      {
        onSuccess: () => {
          toast.success("Twitter collector cookies saved");
          form.reset({ apiKey: "" });
        },
        onError: (err: unknown) => {
          const message =
            err instanceof SocialCredentialsApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Failed to save Twitter collector cookies";
          toast.error(message);
        },
      },
    );
  });

  function handleClear(): void {
    remove.mutate("twitter-collector", {
      onSuccess: () => {
        toast.success("Twitter collector cookies cleared");
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
    <section
      data-testid="twitter-collector-card"
      className="space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Twitter collector cookies</h3>
        <StatusPill
          configured={status.configured}
          updatedAt={status.updatedAt}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        The base64-encoded Twitter/X session cookie blob used by the read-only
        collector (rettiwt-api). Generate it from a browser session; rotate it
        when X invalidates cookies. Falls back to <code>RETTIWT_API_KEY</code>{" "}
        env var when this field is empty.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(e);
        }}
        className="space-y-3"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="twitter-collector-apiKey">Base64 cookie blob</Label>
          <Input
            id="twitter-collector-apiKey"
            type="password"
            autoComplete="off"
            placeholder="Not stored locally — paste to update"
            data-testid="twitter-collector-apiKey-input"
            {...form.register("apiKey")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            data-testid="twitter-collector-save"
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save cookies"}
          </Button>
          {status.configured && !confirming ? (
            <Button
              type="button"
              variant="outline"
              data-testid="twitter-collector-clear"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Clear cookies
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
                data-testid="twitter-collector-clear-confirm"
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
          Configure LinkedIn and Twitter/X auto-posting. Secrets are encrypted at
          rest. Existing values are never displayed — saving replaces all fields
          for that platform.
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
            <Separator />
            <TwitterCollectorSection
              status={statusQuery.data.twitterCollector}
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
