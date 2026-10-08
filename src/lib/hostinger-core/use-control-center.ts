import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { coreApi, CoreApiError } from "./client";

export function useControlCenter() {
  const { session, loading } = useAuth();
  const query = useQuery({
    queryKey: ["core-control-center", session?.user.id],
    queryFn: () => coreApi.controlCenter(),
    enabled: !loading && !!session,
    staleTime: 15_000,
    refetchInterval: (q) => q.state.error ? false : 30_000,
    retry: (attempt, error) => !(error instanceof CoreApiError && [401, 403].includes(error.status)) && attempt < 1,
  });
  return { ...query, waitingForAuth: loading || !session };
}