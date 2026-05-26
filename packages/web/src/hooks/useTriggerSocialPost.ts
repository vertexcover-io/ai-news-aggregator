import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { triggerSocialPost } from "../api/runs";

export function useTriggerSocialPost(
  runId: string,
): UseMutationResult<void, Error, "linkedin" | "twitter"> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channel: "linkedin" | "twitter") =>
      triggerSocialPost(runId, channel),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
}
