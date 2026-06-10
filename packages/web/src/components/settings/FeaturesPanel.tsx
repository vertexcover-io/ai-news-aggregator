import { type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetchAdmin } from "../../api/client";

interface FeatureFlags {
  featureCanon: boolean;
  featureDeliverability: boolean;
  featureEval: boolean;
}

interface Props {
  flags: FeatureFlags;
}

export function FeaturesPanel({ flags }: Props): ReactElement {
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async (data: FeatureFlags) => {
      const res = await apiFetchAdmin("/api/settings/features", {
        method: "PUT",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to save feature flags");
      }
      return res.json() as Promise<FeatureFlags>;
    },
    onSuccess: (saved) => {
      toast.success("Feature flags saved");
      queryClient.setQueryData(["settings", "features"], saved);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to save";
      toast.error(message);
    },
  });

  const toggle = (key: keyof FeatureFlags) => {
    saveMutation.mutate({ ...flags, [key]: !flags[key] });
  };

  return (
    <div className="rounded-lg border bg-white p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Feature Flags</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional features for this tenant. All default to off.
        </p>
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={flags.featureCanon}
            onChange={() => { toggle("featureCanon"); }}
            className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <span className="text-sm font-medium">Canon</span>
            <p className="text-xs text-muted-foreground">
              Enables the public Must Read page and navigation link. Existing data is retained when off.
            </p>
          </div>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={flags.featureDeliverability}
            onChange={() => { toggle("featureDeliverability"); }}
            className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <span className="text-sm font-medium">Deliverability</span>
            <p className="text-xs text-muted-foreground">
              Enables Resend sending-domain verification and deliverability monitoring.
            </p>
          </div>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={flags.featureEval}
            onChange={() => { toggle("featureEval"); }}
            className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <span className="text-sm font-medium">Eval</span>
            <p className="text-xs text-muted-foreground">
              Enables the ranking evaluation dashboard and offline eval pipeline.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}
