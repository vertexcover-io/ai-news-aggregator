/**
 * Sending-domain panel (P14, REQ-084/085): register a domain with Resend,
 * show the DNS records to install, and re-check verification. Mirrors the
 * settings mock: status badge in the card head, DNS records table, paused-
 * broadcast explainer (the broadcast gate, REQ-053, opens only on Verified).
 */
import { useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SendingDomainWire } from "@newsletter/shared/types/tenant";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addSendingDomain,
  getSendingDomain,
  verifySendingDomain,
} from "../../api/sendingDomain";

const QUERY_KEY = ["sending-domain"] as const;

function StatusBadge({ status }: { status: SendingDomainWire["status"] }): ReactElement {
  if (status === "verified") {
    return (
      <Badge data-testid="sending-domain-status" className="bg-emerald-100 text-emerald-800">
        Verified
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge data-testid="sending-domain-status" className="bg-red-100 text-red-800">
        Failed
      </Badge>
    );
  }
  return (
    <Badge data-testid="sending-domain-status" className="bg-amber-100 text-amber-800">
      Pending
    </Badge>
  );
}

function RecordStatusBadge({ status }: { status: string }): ReactElement {
  if (status === "verified") {
    return <Badge className="bg-emerald-100 text-emerald-800">Found</Badge>;
  }
  if (status === "failed" || status === "temporary_failure") {
    return <Badge className="bg-red-100 text-red-800">Failed</Badge>;
  }
  return <Badge className="bg-amber-100 text-amber-800">Waiting</Badge>;
}

export function SendingDomainPanel(): ReactElement {
  const queryClient = useQueryClient();
  const [domainInput, setDomainInput] = useState("");

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getSendingDomain,
  });

  const setDomain = (domain: SendingDomainWire): void => {
    queryClient.setQueryData(QUERY_KEY, domain);
  };

  const add = useMutation({
    mutationFn: addSendingDomain,
    onSuccess: (domain) => {
      setDomain(domain);
      toast.success("Domain registered — add the DNS records below");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const verify = useMutation({
    mutationFn: verifySendingDomain,
    onSuccess: (domain) => {
      setDomain(domain);
      if (domain.status === "verified") {
        toast.success("Domain verified — broadcasts are unlocked");
      } else if (domain.status === "failed") {
        toast.error("Verification failed — check the DNS records");
      } else {
        toast.info("Still pending — DNS can take up to 48h to propagate");
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const domain = query.data ?? null;
  const busy = add.isPending || verify.isPending;

  return (
    <Card data-testid="sending-domain-panel">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>
              <h2 className="text-base font-semibold leading-none">Sending domain</h2>
            </CardTitle>
            <CardDescription>
              Verify a domain to broadcast to your subscribers. Until then the
              broadcast is paused; confirmations &amp; resets still send from
              our shared address.
            </CardDescription>
          </div>
          {domain !== null && <StatusBadge status={domain.status} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {domain === null ? (
          <div className="flex items-center gap-2">
            <Input
              placeholder="yourdomain.com"
              aria-label="Sending domain"
              value={domainInput}
              disabled={busy}
              onChange={(e) => { setDomainInput(e.target.value); }}
            />
            <Button
              type="button"
              disabled={busy || domainInput.trim() === ""}
              onClick={() => { add.mutate(domainInput.trim().toLowerCase()); }}
            >
              Add domain
            </Button>
          </div>
        ) : (
          <>
            <div className="text-sm font-medium">{domain.domain}</div>

            {domain.status === "failed" && domain.reasons !== undefined && (
              <ul
                data-testid="sending-domain-reasons"
                className="list-disc space-y-1 rounded-md border border-red-200 bg-red-50 p-3 pl-7 text-sm text-red-800"
              >
                {domain.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}

            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Add these DNS records
              </div>
              <table className="w-full text-sm" data-testid="sending-domain-records">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1.5 pr-2 font-medium">Type</th>
                    <th className="py-1.5 pr-2 font-medium">Name</th>
                    <th className="py-1.5 pr-2 font-medium">Value</th>
                    <th className="py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {domain.records.map((record) => (
                    <tr key={`${record.record}-${record.type}-${record.name}`} className="border-b last:border-0">
                      <td className="py-1.5 pr-2 font-mono text-xs">{record.type}</td>
                      <td className="py-1.5 pr-2 font-mono text-xs">{record.name}</td>
                      <td className="max-w-[260px] truncate py-1.5 pr-2 font-mono text-xs" title={record.value}>
                        {record.value}
                      </td>
                      <td className="py-1.5">
                        <RecordStatusBadge status={record.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-xs text-muted-foreground">
                DNS can take up to 48h to propagate.
              </span>
              <Button
                type="button"
                size="sm"
                disabled={busy || domain.status === "verified"}
                onClick={() => { verify.mutate(); }}
              >
                Verify domain
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
