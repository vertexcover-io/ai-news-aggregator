import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { triggerEmailSend } from "../api/runs";

export function useTriggerEmailSend(
  runId: string,
): UseMutationResult<void, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => triggerEmailSend(runId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
}
