import { useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChatMessage } from "@backup-brain/shared";
import { supabase } from "@/lib/supabase";

function messagesKey(sessionId: string) {
  return ["chat_messages", sessionId];
}

export function useMessages(sessionId: string | undefined) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const query = useQuery<ChatMessage[]>({
    queryKey: messagesKey(sessionId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("session_id", sessionId!)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as ChatMessage[];
    },
    enabled: !!sessionId,
  });

  // Realtime subscription for new messages (assistant responses)
  useEffect(() => {
    if (!sessionId) return;

    const channel = supabase
      .channel(`messages:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const newMessage = payload.new as ChatMessage;
          queryClient.setQueryData<ChatMessage[]>(
            messagesKey(sessionId),
            (old) => {
              if (!old) return [newMessage];
              // Avoid duplicates (optimistic insert may already have it)
              if (old.some((m) => m.id === newMessage.id)) return old;
              return [...old, newMessage];
            },
          );
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [sessionId, queryClient]);

  return query;
}

export function useSendMessage(sessionId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (content: string) => {
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({ session_id: sessionId!, role: "user", content })
        .select()
        .single();

      if (error) throw error;
      return data as ChatMessage;
    },
    // Optimistic update: show the message immediately
    onMutate: async (content: string) => {
      await queryClient.cancelQueries({
        queryKey: messagesKey(sessionId!),
      });

      const previous = queryClient.getQueryData<ChatMessage[]>(
        messagesKey(sessionId!),
      );

      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        session_id: sessionId!,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };

      queryClient.setQueryData<ChatMessage[]>(
        messagesKey(sessionId!),
        (old) => (old ? [...old, optimistic] : [optimistic]),
      );

      return { previous };
    },
    onError: (_err, _content, context) => {
      if (context?.previous) {
        queryClient.setQueryData(messagesKey(sessionId!), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey(sessionId!) });
    },
  });
}

/** Returns true when the last message is from user (waiting for assistant response). */
export function useIsThinking(messages: ChatMessage[] | undefined): boolean {
  if (!messages || messages.length === 0) return false;
  return messages[messages.length - 1].role === "user";
}
