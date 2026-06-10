import { useQuery, useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getAdminSources,
  createAdminSource,
  patchAdminSource,
  deleteAdminSource,
  type AdminSource,
  type PatchSourceInput,
} from "../api/sources-admin";

export function useAdminSources(): UseQueryResult<AdminSource[]> {
  return useQuery<AdminSource[]>({
    queryKey: ["admin-sources"],
    queryFn: getAdminSources,
    refetchOnWindowFocus: false,
  });
}

export function useCreateAdminSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAdminSource,
    onSuccess: () => {
      toast.success("Source added");
      void queryClient.invalidateQueries({ queryKey: ["admin-sources"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function usePatchAdminSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchSourceInput }) =>
      patchAdminSource(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-sources"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useDeleteAdminSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAdminSource,
    onSuccess: () => {
      toast.success("Source removed");
      void queryClient.invalidateQueries({ queryKey: ["admin-sources"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
