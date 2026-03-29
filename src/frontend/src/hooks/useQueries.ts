import { useQuery } from "@tanstack/react-query";
import type { ConversationEntry } from "../backend";
import { useActor } from "./useActor";

export function useGetAllMessages() {
  const { actor, isFetching } = useActor();
  return useQuery<ConversationEntry[]>({
    queryKey: ["messages"],
    queryFn: async () => {
      if (!actor) return [];
      const msgs = await actor.getAllMessages();
      return [...msgs].sort((a, b) => Number(a.timestamp - b.timestamp));
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 10000,
  });
}

export function useIsConnected() {
  const { actor, isFetching } = useActor();
  return useQuery<boolean>({
    queryKey: ["connected"],
    queryFn: async () => {
      if (!actor) return false;
      return actor.isConnected();
    },
    enabled: !!actor && !isFetching,
    refetchInterval: 15000,
  });
}
