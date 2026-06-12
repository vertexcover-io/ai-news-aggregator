/**
 * Features panel (P16, REQ-093): the three optional capabilities —
 * Deliverability analytics, Canon ("Must Read") and Eval — all OFF by
 * default, each toggling independently. Turning Canon off hides the public
 * Must Read page/nav but RETAINS the entries (EDGE-014).
 */
import { type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TenantFeatureFlagsWire } from "@newsletter/shared/types/tenant";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { getFeatureFlags, putFeatureFlags } from "../../api/notifications";

const QUERY_KEY = ["feature-flags"] as const;

const FEATURES: {
  key: keyof TenantFeatureFlagsWire;
  title: string;
  description: string;
}[] = [
  {
    key: "featureDeliverability",
    title: "Deliverability analytics",
    description:
      "A dashboard of opens, bounces, complaints, and delivery events for your sends.",
  },
  {
    key: "featureCanon",
    title: "Canon · “Must Read”",
    description:
      "Maintain a curated must-read list and show a Must Read page + nav link on your public site.",
  },
  {
    key: "featureEval",
    title: "Eval",
    description:
      "Offline ranking evaluation tools for tuning your prompts against graded fixtures.",
  },
];

export function FeaturesPanel(): ReactElement {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getFeatureFlags });

  const save = useMutation({
    mutationFn: putFeatureFlags,
    onSuccess: (saved) => {
      queryClient.setQueryData(QUERY_KEY, saved);
      toast.success("Features updated");
    },
    onError: async (err: Error) => {
      toast.error(err.message);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const flags = query.data;

  const toggle = (key: keyof TenantFeatureFlagsWire, value: boolean): void => {
    if (!flags) return;
    const next = { ...flags, [key]: value };
    // Optimistic flip so the switch tracks the click; a failed PUT refetches.
    queryClient.setQueryData(QUERY_KEY, next);
    save.mutate(next);
  };

  return (
    <Card data-testid="features-panel">
      <CardHeader>
        <CardTitle>Features</CardTitle>
        <CardDescription>
          Optional capabilities, off by default. Turn on what you need.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {FEATURES.map((feature) => (
          <div
            key={feature.key}
            className="flex items-center justify-between border-t pt-4 first:border-t-0 first:pt-0"
          >
            <div>
              <p className="text-sm font-medium">{feature.title}</p>
              <p className="text-xs text-muted-foreground">{feature.description}</p>
            </div>
            <Switch
              aria-label={feature.title}
              checked={flags?.[feature.key] ?? false}
              disabled={flags === undefined}
              onCheckedChange={(value) => {
                toggle(feature.key, value);
              }}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
