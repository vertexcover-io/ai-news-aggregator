import { useEffect, type ReactElement } from "react";
import { useForm } from "react-hook-form";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { SendingDomainStatus } from "@newsletter/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getDomain,
  registerDomain,
  verifyDomain,
  type SendingDomain,
} from "@/api/sending-domains";

interface DnsRecord {
  type?: string;
  name?: string;
  value?: string;
  status?: string;
  record?: string;
}

const STATUS_LABEL: Record<SendingDomainStatus, string> = {
  none: "Not set up",
  pending: "Pending",
  verified: "Verified",
  failed: "Failed",
};

function StatusBadge({ status }: { status: SendingDomainStatus }): ReactElement {
  if (status === "verified") {
    return (
      <Badge variant="outline">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        {STATUS_LABEL[status]}
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline">
        <span className="size-1.5 rounded-full bg-red-500" aria-hidden />
        {STATUS_LABEL[status]}
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge variant="outline">
        <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
        {STATUS_LABEL[status]}
      </Badge>
    );
  }
  return <Badge variant="secondary">{STATUS_LABEL[status]}</Badge>;
}

function recordFound(record: DnsRecord): boolean {
  const s = (record.status ?? "").toLowerCase();
  return s === "verified" || s === "found" || s === "ok";
}

interface DomainForm {
  domain: string;
}

export function SendingDomainPanel(): ReactElement {
  const queryClient = useQueryClient();

  const domainQuery = useQuery({
    queryKey: ["sending-domain"],
    queryFn: getDomain,
  });

  const {
    register,
    handleSubmit,
    reset,
  } = useForm<DomainForm>({
    defaultValues: { domain: "" },
  });

  useEffect(() => {
    if (domainQuery.data?.domain) {
      reset({ domain: domainQuery.data.domain });
    }
  }, [domainQuery.data?.domain, reset]);

  function onSaved(saved: SendingDomain): void {
    queryClient.setQueryData(["sending-domain"], saved);
  }

  const registerMutation = useMutation({
    mutationFn: (domain: string) => registerDomain(domain),
    onSuccess: (saved) => {
      toast.success("Domain registered — add the DNS records below");
      onSaved(saved);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to register domain");
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () => verifyDomain(),
    onSuccess: (saved) => {
      if (saved.verified) toast.success("Domain verified");
      else toast.message("Not verified yet — DNS may still be propagating");
      onSaved(saved);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Verification failed");
    },
  });

  const onSubmit = handleSubmit((values) => {
    const domain = values.domain.trim();
    if (!domain) return;
    registerMutation.mutate(domain);
  });

  const data = domainQuery.data;
  const status: SendingDomainStatus = data?.status ?? "none";
  const records = (data?.dnsRecords ?? []) as DnsRecord[];

  return (
    <Card id="domain">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Sending domain</CardTitle>
          <CardDescription>
            Verify a domain to broadcast to your subscribers. Until then the
            broadcast is paused; confirmations &amp; resets still send from our
            shared address.
          </CardDescription>
        </div>
        <StatusBadge status={status} />
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            void onSubmit(e);
          }}
        >
          <Label htmlFor="sending-domain">Domain</Label>
          <div className="flex gap-2">
            <Input
              id="sending-domain"
              placeholder="example.com"
              {...register("domain")}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={registerMutation.isPending}
              className="min-h-[44px]"
            >
              {registerMutation.isPending ? "Saving..." : "Save domain"}
            </Button>
          </div>
        </form>

        {records.length > 0 && (
          <div className="space-y-2">
            <Label>Add these DNS records</Label>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record, idx) => (
                  <TableRow key={`${record.name ?? ""}-${String(idx)}`}>
                    <TableCell className="font-mono text-xs">
                      {record.type ?? record.record ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs break-all">
                      {record.name ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs break-all">
                      {record.value ?? "—"}
                    </TableCell>
                    <TableCell>
                      {recordFound(record) ? (
                        <Badge variant="outline">Found</Badge>
                      ) : (
                        <Badge variant="secondary">Waiting</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {data?.failureReasons && data.failureReasons.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-red-600">
            {data.failureReasons.map((reason, idx) => (
              <li key={idx}>{reason}</li>
            ))}
          </ul>
        )}

        {status !== "none" && (
          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">
              DNS can take up to 48h to propagate.
            </span>
            <Button
              type="button"
              onClick={() => {
                verifyMutation.mutate();
              }}
              disabled={verifyMutation.isPending}
              className="min-h-[44px]"
            >
              {verifyMutation.isPending ? "Verifying..." : "Verify domain"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
