import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { deleteArchive } from "../api/archives";

export function useDeleteArchive(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => deleteArchive(runId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
}
