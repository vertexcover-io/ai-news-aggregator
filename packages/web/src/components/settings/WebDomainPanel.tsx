/**
 * Web-domain panel (Fix #3, Phase C): connect your own domain to your public
 * site (Vercel-style). Enter a domain → add the shown DNS record → Verify.
 * Only a verified domain is served + gets an automatic TLS cert.
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
import type { CustomDomainStatus } from "@newsletter/shared/types/tenant";
import {
  getWebDomain,
  registerWebDomain,
  verifyWebDomain,
  WebDomainApiError,
} from "../../api/webDomain";

const QUERY_KEY = ["web-domain"] as const;

const STATUS_STYLE: Record<CustomDomainStatus, { label: string; cls: string }> = {
  verified: { label: "Verified", cls: "text-green-700" },
  pending: { label: "Pending DNS", cls: "text-amber-600" },
  failed: { label: "Not found yet", cls: "text-red-600" },
};

export function WebDomainPanel(): ReactElement {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getWebDomain });
  const [domain, setDomain] = useState("");

  const onResult = (wire: unknown): void => {
    queryClient.setQueryData(QUERY_KEY, wire);
  };
  const onErr = (err: unknown): void => {
    toast.error(err instanceof WebDomainApiError ? err.message : "Request failed");
  };

  const add = useMutation({
    mutationFn: registerWebDomain,
    onSuccess: (wire) => {
      onResult(wire);
      toast.success("Domain added — add the DNS record below, then Verify");
    },
    onError: onErr,
  });
  const verify = useMutation({
    mutationFn: verifyWebDomain,
    onSuccess: (wire) => {
      onResult(wire);
      toast[wire.status === "verified" ? "success" : "error"](
        wire.status === "verified" ? "Domain verified" : "DNS not found yet — check the record and retry",
      );
    },
    onError: onErr,
  });

  const data = query.data;
  const status = data?.status ?? null;
  const record = data?.record ?? null;

  return (
    <Card data-testid="web-domain-panel">
      <CardHeader>
        <CardTitle>Custom web domain</CardTitle>
        <CardDescription>
          Serve your public site on your own domain (e.g. news.yourcompany.com).
          Your <code>x.{"{root}"}</code> subdomain keeps working either way.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="web-domain-input">Domain</Label>
            <Input
              id="web-domain-input"
              data-testid="web-domain-input"
              value={domain}
              placeholder={data?.domain ?? "news.yourcompany.com"}
              onChange={(e) => { setDomain(e.target.value); }}
            />
          </div>
          <Button
            type="button"
            size="sm"
            data-testid="web-domain-add-btn"
            disabled={add.isPending || domain.trim().length === 0}
            onClick={() => { add.mutate(domain.trim()); }}
          >
            {add.isPending ? "Adding…" : "Add domain"}
          </Button>
        </div>

        {data?.domain ? (
          <div className="space-y-2" data-testid="web-domain-state">
            <p className="text-sm">
              {data.domain} —{" "}
              <span
                data-testid="web-domain-status"
                className={status ? STATUS_STYLE[status].cls : ""}
              >
                {status ? STATUS_STYLE[status].label : "—"}
              </span>
            </p>
            {record ? (
              <div className="rounded-md border p-3 text-sm">
                <p className="mb-1 font-medium">Add this DNS record:</p>
                <table className="font-mono text-xs">
                  <tbody>
                    <tr>
                      <td className="pr-3 text-muted-foreground">Type</td>
                      <td data-testid="web-domain-record-type">{record.type}</td>
                    </tr>
                    <tr>
                      <td className="pr-3 text-muted-foreground">Name</td>
                      <td>{record.name}</td>
                    </tr>
                    <tr>
                      <td className="pr-3 text-muted-foreground">Value</td>
                      <td data-testid="web-domain-record-value">{record.value}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted-foreground">
                  DNS can take a few minutes to propagate. Apex domains must use
                  an A record. Ensure no CAA record blocks Let’s Encrypt.
                </p>
              </div>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="web-domain-verify-btn"
              disabled={verify.isPending}
              onClick={() => { verify.mutate(); }}
            >
              {verify.isPending ? "Checking…" : "Verify / re-check"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
