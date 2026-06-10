import type { ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  patchTenantSettings,
  type TenantSettings,
  type TenantSettingsPatch,
} from "@/api/tenant-settings";

interface FeatureFlagsPanelProps {
  settings: TenantSettings;
}

type FlagKey = "deliverabilityEnabled" | "canonEnabled" | "evalEnabled";

interface FlagSpec {
  key: FlagKey;
  title: string;
  description: string;
  label: string;
}

const FLAGS: FlagSpec[] = [
  {
    key: "deliverabilityEnabled",
    title: "Deliverability analytics",
    description:
      "A dashboard of opens, bounces, complaints, and delivery events for your sends.",
    label: "Enable deliverability analytics",
  },
  {
    key: "canonEnabled",
    title: "Canon · Must Read",
    description:
      "Maintain a curated must-read list and show a Must Read page + nav link on your public site.",
    label: "Enable Canon Must Read",
  },
  {
    key: "evalEnabled",
    title: "Eval",
    description:
      "Offline ranking evaluation tools for tuning your prompts against graded fixtures.",
    label: "Enable Eval",
  },
];

export function FeatureFlagsPanel({
  settings,
}: FeatureFlagsPanelProps): ReactElement {
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (patch: TenantSettingsPatch) => patchTenantSettings(patch),
    onSuccess: (saved) => {
      toast.success("Features updated");
      queryClient.setQueryData(["tenant-settings"], saved);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to update features");
    },
  });

  return (
    <Card id="features">
      <CardHeader>
        <CardTitle>Features</CardTitle>
        <CardDescription>
          Optional capabilities, off by default. Turn on what you need.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {FLAGS.map((flag) => (
          <div
            key={flag.key}
            className="flex items-start justify-between gap-4 border-t pt-4 first:border-0 first:pt-0"
          >
            <div>
              <h4 className="text-sm font-medium">{flag.title}</h4>
              <p className="text-sm text-muted-foreground">{flag.description}</p>
            </div>
            <Switch
              aria-label={flag.label}
              checked={settings[flag.key]}
              disabled={saveMutation.isPending}
              onCheckedChange={(value) => {
                saveMutation.mutate({ [flag.key]: value });
              }}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
