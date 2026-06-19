/**
 * Tenant source rows for the Settings sources panel (P8, REQ-070/072/074).
 * Query + add/toggle/remove mutations against the auth-gated /api/sources.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  ManualSourceType,
  TenantSourceWire,
} from "@newsletter/shared/types";
import {
  addTenantSource,
  fetchTenantSources,
  removeTenantSource,
  setTenantSourceEnabled,
} from "../api/sources";

const QUERY_KEY = ["tenant-sources"] as const;

export interface UseTenantSourcesResult {
  query: UseQueryResult<TenantSourceWire[]>;
  add: UseMutationResult<
    TenantSourceWire,
    Error,
    { type: ManualSourceType; value: string }
  >;
  toggle: UseMutationResult<
    TenantSourceWire,
    Error,
    { id: string; enabled: boolean }
  >;
  remove: UseMutationResult<void, Error, string>;
}

export function useTenantSources(): UseTenantSourcesResult {
  const queryClient = useQueryClient();
  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const query = useQuery<TenantSourceWire[]>({
    queryKey: QUERY_KEY,
    queryFn: fetchTenantSources,
    refetchOnWindowFocus: false,
  });

  const add = useMutation({
    mutationFn: addTenantSource,
    onSuccess: async (created) => {
      toast.success(`Added ${created.name}`);
      await invalidate();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setTenantSourceEnabled(id, enabled),
    onSuccess: async () => invalidate(),
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const remove = useMutation({
    mutationFn: removeTenantSource,
    onSuccess: async () => {
      toast.success("Source removed");
      await invalidate();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return { query, add, toggle, remove };
}
