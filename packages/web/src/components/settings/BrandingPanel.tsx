/**
 * Branding panel (FIX #1): view + edit the brand identity captured during
 * onboarding — newsletter name, headline, topic strip, sub-tagline, and logo.
 * Before this, those fields were only settable in the onboarding wizard and
 * invisible in Admin Settings.
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
import {
  getBrandingSettings,
  putBrandingSettings,
  uploadBrandingLogo,
} from "../../api/branding";

const QUERY_KEY = ["branding-settings"] as const;

const LOGO_ERRORS: Record<string, string> = {
  too_large: "That file is over 512 KB — please upload a smaller image.",
  unsupported_type: "Unsupported file type — use PNG, JPEG, SVG, or WebP.",
};

export function BrandingPanel(): ReactElement {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getBrandingSettings });

  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("");
  const [topicStrip, setTopicStrip] = useState("");
  const [subtagline, setSubtagline] = useState("");
  const [hydratedAt, setHydratedAt] = useState(0);

  // Render-time hydration (D-004 pattern): adopt the fetched values once per
  // server snapshot so local edits aren't clobbered by background refetches.
  if (query.data && query.dataUpdatedAt !== hydratedAt) {
    setName(query.data.name);
    setHeadline(query.data.headline ?? "");
    setTopicStrip(query.data.topicStrip ?? "");
    setSubtagline(query.data.subtagline ?? "");
    setHydratedAt(query.dataUpdatedAt);
  }

  const save = useMutation({
    mutationFn: putBrandingSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(QUERY_KEY, saved);
      toast.success("Branding saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const uploadLogoMut = useMutation({
    mutationFn: (file: File) => uploadBrandingLogo(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Logo updated");
    },
    onError: (err: Error) =>
      toast.error(LOGO_ERRORS[err.message] ?? err.message),
  });

  const handleSave = (): void => {
    if (name.trim() === "") {
      toast.error("Newsletter name is required");
      return;
    }
    save.mutate({
      name: name.trim(),
      headline: headline.trim() === "" ? null : headline.trim(),
      topicStrip: topicStrip.trim() === "" ? null : topicStrip.trim(),
      subtagline: subtagline.trim() === "" ? null : subtagline.trim(),
    });
  };

  return (
    <Card data-testid="branding-panel">
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>
          Your newsletter's identity — shown on the public site and in emails.
          Set during onboarding; update it here anytime.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="branding-name">Newsletter name</Label>
          <Input
            id="branding-name"
            placeholder="The Inference"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="branding-headline">Headline</Label>
          <Input
            id="branding-headline"
            placeholder="The daily read for people building with inference."
            value={headline}
            onChange={(e) => {
              setHeadline(e.target.value);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="branding-topic-strip">Topic strip</Label>
          <Input
            id="branding-topic-strip"
            placeholder="Serving · Quantization · Latency · Cost"
            value={topicStrip}
            onChange={(e) => {
              setTopicStrip(e.target.value);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Shown under the headline. Separate topics with “·”.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="branding-subtagline">Sub-tagline</Label>
          <Input
            id="branding-subtagline"
            placeholder="No funding rounds. No leaderboards. Just the runtime."
            value={subtagline}
            onChange={(e) => {
              setSubtagline(e.target.value);
            }}
          />
        </div>

        <div className="space-y-1.5 border-t pt-4">
          <Label htmlFor="branding-logo">Logo</Label>
          <div className="flex items-center gap-3">
            {query.data?.hasLogo === true && query.data.logoUrl !== null ? (
              <img
                src={query.data.logoUrl}
                alt="Current logo"
                className="h-12 w-12 rounded border object-contain"
              />
            ) : (
              <span className="text-xs text-muted-foreground">
                No logo uploaded
              </span>
            )}
            <Input
              id="branding-logo"
              type="file"
              aria-label="Upload logo"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              disabled={uploadLogoMut.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadLogoMut.mutate(file);
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            PNG, JPEG, SVG, or WebP, up to 512 KB.
          </p>
        </div>

        <div className="flex justify-end border-t pt-4">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={save.isPending || query.isLoading}
          >
            {save.isPending ? "Saving…" : "Save branding"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
