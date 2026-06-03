import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import type {
  CollectorHealthSnapshot,
  HealthCheckCollector,
} from "@newsletter/shared/types";
import {
  getCollectorHealthSnapshot,
  triggerCollectorHealth,
} from "../api/collector-health";

const POLL_INTERVAL_MS = 2000;
const QUERY_KEY = ["collector-health"] as const;

export function useCollectorHealth(): UseQueryResult<CollectorHealthSnapshot> {
  return useQuery<CollectorHealthSnapshot>({
    queryKey: QUERY_KEY,
    queryFn: getCollectorHealthSnapshot,
    refetchInterval: (query) => {
      const snap = query.state.data;
      if (snap?.collectors.some((c) => c.status === "running")) {
        return POLL_INTERVAL_MS;
      }
      return false;
    },
    retry: false,
  });
}

export function useCollectorHealthTrigger(): {
  trigger: (collector?: HealthCheckCollector) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (collector?: HealthCheckCollector) =>
      triggerCollectorHealth(collector),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      void queryClient.refetchQueries({ queryKey: QUERY_KEY });
    },
  });

  return {
    trigger: (collector?: HealthCheckCollector) => {
      mutation.mutate(collector);
    },
    isPending: mutation.isPending,
  };
}
