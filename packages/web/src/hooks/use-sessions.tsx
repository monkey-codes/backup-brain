import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChatSession } from "@backup-brain/shared";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";

const SESSIONS_KEY = ["chat_sessions"];

export function useSessions() {
  return useQuery<ChatSession[]>({
    queryKey: SESSIONS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return data as ChatSession[];
    },
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("chat_sessions")
        .insert({ user_id: user!.id })
        .select()
        .single();

      if (error) throw error;
      return data as ChatSession;
    },
    onSuccess: (newSession) => {
      queryClient.setQueryData<ChatSession[]>(SESSIONS_KEY, (old) =>
        old ? [newSession, ...old] : [newSession]
      );
    },
  });
}
