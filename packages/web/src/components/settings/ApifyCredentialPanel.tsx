/**
 * Apify credential panel (Phase 5, REQ-019): super-admin-only section to
 * set/clear the platform-level Apify API token.
 *
 * - Shows configured status + updatedAt (never the token value).
 * - Masked (type=password) input for entering a new token.
 * - "Save" → PUT /api/super/app-credentials/apify.
 * - "Clear" → DELETE /api/super/app-credentials/apify (visible when configured).
 *
 * This panel is rendered only when the session user is super_admin (gated
 * in SettingsPage.tsx). Mirrors the EmailPanel / BrandingPanel pattern.
 */
import { useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  getAppCredentialsStatus,
  putApifyToken,
  deleteApifyToken,
  type AppCredentialsStatusResponse,
} from "../../api/appCredentials";

const QUERY_KEY = ["app-credentials-status"] as const;

interface TokenForm {
  apiToken: string;
}

export function ApifyCredentialPanel(): ReactElement {
  const queryClient = useQueryClient();
  const query = useQuery<AppCredentialsStatusResponse>({
    queryKey: QUERY_KEY,
    queryFn: getAppCredentialsStatus,
  });

  const apify = query.data?.apify;
  const configured = apify?.configured ?? false;
  const updatedAt = apify?.updatedAt ?? null;

  const { register, handleSubmit, reset } = useForm<TokenForm>({
    defaultValues: { apiToken: "" },
  });

  // Track whether we're showing the "enter new token" form when already configured.
  const [editing, setEditing] = useState(false);

  const saveMutation = useMutation({
    mutationFn: ({ apiToken }: TokenForm) => putApifyToken(apiToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Apify token saved");
      reset();
      setEditing(false);
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to save Apify token",
      );
    },
  });

  const clearMutation = useMutation({
    mutationFn: deleteApifyToken,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Apify token removed");
      setEditing(false);
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove Apify token",
      );
    },
  });

  const showForm = !configured || editing;

  return (
    <Card data-testid="apify-credential-panel">
      <CardHeader>
        <CardTitle>Apify integration</CardTitle>
        <CardDescription>
          Platform-level Apify API token used by the Reddit collector. Set once
          — applies to all tenants. Never visible after saving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status line */}
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              configured
                ? "bg-green-100 text-green-800"
                : "bg-gray-100 text-gray-600"
            }`}
            data-testid="apify-status-badge"
          >
            {configured ? "Configured" : "Not configured"}
          </span>
          {configured && updatedAt !== null ? (
            <span className="text-xs text-muted-foreground">
              Updated {new Date(updatedAt).toLocaleString()}
            </span>
          ) : null}
        </div>

        {/* Token entry form */}
        {showForm ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit((values) => {
                saveMutation.mutate(values);
              })(e);
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="apify-api-token">Apify API token</Label>
              <Input
                id="apify-api-token"
                type="password"
                placeholder="apify_api_…"
                autoComplete="new-password"
                {...register("apiToken")}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving…" : "Save"}
              </Button>
              {configured ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          /* Configured + not editing — show action buttons */
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(true);
              }}
            >
              Update token
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={clearMutation.isPending}
              onClick={() => {
                clearMutation.mutate();
              }}
            >
              {clearMutation.isPending ? "Clearing…" : "Clear"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
