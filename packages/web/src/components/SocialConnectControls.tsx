import { useEffect, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  useDeleteSocialCredentials,
  type Platform,
  type TwitterOAuthStatus,
} from "../api/socialCredentials";

/**
 * Shared OAuth connect / reconnect / disconnect control (Fix #2).
 *
 * Drives the per-tenant LinkedIn + Twitter OAuth flow in both Settings and the
 * onboarding wizard. The platform-specific status hook and start function are
 * injected so one component serves both platforms; `returnTo` tells the
 * session-less callback where to send the browser back (settings vs wizard),
 * and `onBeforeConnect` lets the wizard persist its draft before the redirect.
 *
 * LinkedIn and Twitter share the OAuth status shape, so `TwitterOAuthStatus`
 * doubles as the common type here.
 */
export type OAuthStatus = TwitterOAuthStatus;

export interface SocialConnectControlsProps {
  platform: Platform;
  label: string;
  returnTo: string;
  useStatus: () => UseQueryResult<OAuthStatus>;
  start: (returnTo?: string) => Promise<{ authorizeUrl: string }>;
  onBeforeConnect?: () => Promise<void>;
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

export function SocialConnectControls({
  platform,
  label,
  returnTo,
  useStatus,
  start,
  onBeforeConnect,
}: SocialConnectControlsProps): ReactElement {
  const status = useStatus();
  const disconnect = useDeleteSocialCredentials();
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle ?<platform>=connected / error on mount (the OAuth callback appends
  // it to the returnTo surface). Run once — strip the params afterwards.
  useEffect(() => {
    const param = searchParams.get(platform);
    if (!param) return;

    if (param === "connected") {
      toast.success(`${label} connected successfully`);
      void status.refetch();
    } else if (param === "error") {
      const reason = searchParams.get("reason") ?? "unknown";
      toast.error(`${label} connection failed: ${reason}`);
    }

    const next = new URLSearchParams(searchParams);
    next.delete(platform);
    next.delete("reason");
    setSearchParams(next, { replace: true });
    // Intentionally on-mount only: handle the ?<platform>= return param once,
    // then strip it. Re-runs (after the strip) are no-ops — the param is gone.
  }, []);

  async function handleConnect(): Promise<void> {
    try {
      if (onBeforeConnect) await onBeforeConnect();
      const result = await start(returnTo);
      window.location.assign(result.authorizeUrl);
    } catch {
      toast.error(`Failed to start ${label} connection`);
    }
  }

  const data = status.data;
  const connected = data?.connected ?? false;
  const clientConfigured = data?.clientConfigured ?? false;
  const isConnectDisabled = !clientConfigured;

  const statusText = (): string => {
    if (!data || !connected) return "Not connected";
    const parts: string[] = [];
    if (data.connectedAs) parts.push(`Connected as ${data.connectedAs}`);
    if (data.expiresAt) parts.push(`expires ${formatExpiresAt(data.expiresAt)}`);
    parts.push(
      data.hasRefreshToken
        ? "refresh token ✓"
        : "refresh token ✗ (reconnect to enable)",
    );
    return parts.join(" · ");
  };

  return (
    <div data-testid={`${platform}-connection`} className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">
        OAuth Connection
      </h4>
      <p data-testid={`${platform}-conn-status`} className="text-sm">
        {status.isLoading ? "Loading…" : statusText()}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`${platform}-connect-btn`}
          disabled={isConnectDisabled}
          onClick={() => {
            void handleConnect();
          }}
        >
          {connected ? `Reconnect ${label}` : `Connect ${label}`}
        </Button>
        {connected ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={`${platform}-disconnect-btn`}
            disabled={disconnect.isPending}
            onClick={() => {
              disconnect.mutate(platform, {
                onSuccess: () => {
                  toast.success(`${label} disconnected`);
                  void status.refetch();
                },
                onError: (err: unknown) => {
                  toast.error(
                    err instanceof Error ? err.message : "Failed to disconnect",
                  );
                },
              });
            }}
          >
            {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
          </Button>
        ) : null}
        {isConnectDisabled ? (
          <p className="text-xs text-muted-foreground">
            The shared {label} app is not configured yet — ask a platform super
            admin to set it up
          </p>
        ) : null}
      </div>
    </div>
  );
}
