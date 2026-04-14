import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { UserSettings } from "@newsletter/shared";
import { getSettings } from "../api/settings";

export function useSettings(): UseQueryResult<UserSettings | null> {
  return useQuery<UserSettings | null>({
    queryKey: ["settings"],
    queryFn: getSettings,
    refetchOnWindowFocus: false,
  });
}
