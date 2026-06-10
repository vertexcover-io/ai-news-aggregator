import { useEffect, useRef, useState, type ReactElement } from "react";
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
import { uploadLogo } from "@/api/onboarding";

interface BrandingPanelProps {
  settings: TenantSettings;
}

interface BrandingForm {
  name: string;
  headline: string;
  topicStrip: string;
  subtagline: string;
}

const MAX_LOGO_BYTES = 512 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("failed to read file"));
    };
    reader.readAsDataURL(file);
  });
}

export function BrandingPanel({ settings }: BrandingPanelProps): ReactElement {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoName, setLogoName] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isDirty },
  } = useForm<BrandingForm>({
    defaultValues: {
      name: settings.name ?? "",
      headline: settings.headline ?? "",
      topicStrip: settings.topicStrip ?? "",
      subtagline: settings.subtagline ?? "",
    },
  });

  useEffect(() => {
    reset({
      name: settings.name ?? "",
      headline: settings.headline ?? "",
      topicStrip: settings.topicStrip ?? "",
      subtagline: settings.subtagline ?? "",
    });
  }, [settings, reset]);

  const saveMutation = useMutation({
    mutationFn: (patch: TenantSettingsPatch) => patchTenantSettings(patch),
    onSuccess: (saved) => {
      toast.success("Branding saved");
      queryClient.setQueryData(["tenant-settings"], saved);
      void queryClient.invalidateQueries({ queryKey: ["tenant-branding"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to save branding");
    },
  });

  const logoMutation = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_LOGO_BYTES) {
        throw new Error("Logo must be 512 KB or smaller");
      }
      const data = await fileToBase64(file);
      return uploadLogo(file.type, data);
    },
    onSuccess: () => {
      toast.success("Logo updated");
      void queryClient.invalidateQueries({ queryKey: ["tenant-branding"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to upload logo");
    },
  });

  const onSubmit = handleSubmit((values) => {
    saveMutation.mutate({
      name: values.name.trim() || null,
      headline: values.headline.trim() || null,
      topicStrip: values.topicStrip.trim() || null,
      subtagline: values.subtagline.trim() || null,
    });
  });

  function onPickLogo(): void {
    fileInputRef.current?.click();
  }

  function onLogoChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoName(file.name);
    logoMutation.mutate(file);
    e.target.value = "";
  }

  return (
    <Card id="branding">
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>
          Shown on your public site and in emails.
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
            <Label htmlFor="branding-name">Newsletter name</Label>
            <Input
              id="branding-name"
              placeholder="The Inference"
              {...register("name")}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Logo</Label>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={onPickLogo}
                disabled={logoMutation.isPending}
                className="min-h-[44px]"
              >
                {logoMutation.isPending ? "Uploading..." : "Replace logo"}
              </Button>
              <span className="text-sm text-muted-foreground">
                {logoName ?? "PNG · JPEG · SVG · WebP · ≤ 512 KB"}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                aria-label="Upload logo"
                onChange={onLogoChange}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="branding-headline">Headline</Label>
            <Input
              id="branding-headline"
              placeholder="The daily read for people building with *inference.*"
              {...register("headline")}
            />
            <p className="text-sm text-muted-foreground">
              Wrap a phrase in *asterisks* to accent it.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="branding-topic-strip">Topic strip</Label>
            <Input
              id="branding-topic-strip"
              placeholder="LLMs · agents · inference"
              {...register("topicStrip")}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="branding-subtagline">Subtagline</Label>
            <Input
              id="branding-subtagline"
              placeholder="Your daily AI briefing"
              {...register("subtagline")}
            />
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">
              Subdomain:{" "}
              <code className="font-mono">{settings.slug}</code>
            </span>
            <Button
              type="submit"
              disabled={saveMutation.isPending || !isDirty}
              className="min-h-[44px]"
            >
              {saveMutation.isPending ? "Saving..." : "Save branding"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
